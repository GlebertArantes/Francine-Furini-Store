#!/usr/bin/env python3
"""Cópia datada do catálogo PÚBLICO e das fotos originais; nunca acessa dados pessoais.

Uso:
  --verify [--dir PASTA]            confere os arquivos locais (sem rede). Padrão: a cópia mais recente.
  (sem --verify)                    baixa fotos ausentes do Storage público e confere os hashes.
  --create catalogo.json --dir PASTA [--reuse PASTA_ANTIGA] [--etags etags.json]
                                    cria uma nova cópia a partir de um catálogo público já exportado.
                                    Fotos vêm de --reuse (somente se o SHA-256 bater com o manifesto antigo)
                                    ou do Storage público. --etags (caminho -> eTag do Storage) registra e
                                    confere o MD5 de cada foto contra o que o Storage informa.
Nunca sobrescreve uma cópia existente divergente.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import re
import urllib.request

BACKUPS = Path(__file__).resolve().parent.parent / "backups/catalogo"
BASE = "https://txgatyftvtpkgqlncxju.supabase.co/storage/v1/object/public/product-images/"
PATH_RE = re.compile(r"products/[a-f0-9-]{36}/[a-zA-Z0-9_.-]+")
EXT_TYPE = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def md5(data):
    return hashlib.md5(data).hexdigest()  # noqa: S324 - o eTag do Storage é MD5; usado só para conferência


def latest_dir():
    dirs = sorted(p for p in BACKUPS.iterdir() if p.is_dir() and (p / "manifest.json").exists())
    if not dirs:
        raise SystemExit("Nenhuma cópia encontrada em backups/catalogo")
    return dirs[-1]


def check_path(item):
    path = item["storage_path"]
    if not PATH_RE.fullmatch(path):
        raise ValueError("Caminho de imagem inválido")
    if item["file"] != "images/" + path:
        raise ValueError("Destino inválido")


def verify(root, allow_download):
    manifest = json.loads((root / "manifest.json").read_text())
    snapshot = json.loads((root / "catalogo.json").read_text())
    if sha((root / "catalogo.json").read_bytes()) != manifest["catalog_sha256"]:
        raise ValueError("Catálogo diverge do manifesto")
    expected = {i["storage_path"] for p in snapshot["products"] for i in p["product_images"]}
    if expected != {i["storage_path"] for i in manifest["images"]}:
        raise ValueError("Manifesto não corresponde às imagens do catálogo")
    if manifest["products"] != len(snapshot["products"]):
        raise ValueError("Contagem de produtos diverge do manifesto")
    if len(manifest["images"]) != len(expected):
        raise ValueError("Contagem de imagens diverge do manifesto")
    if "variants" in manifest and manifest["variants"] != sum(len(p["product_variants"]) for p in snapshot["products"]):
        raise ValueError("Contagem de variantes diverge do manifesto")
    for item in manifest["images"]:
        check_path(item)
        dest = root / item["file"]
        if dest.exists():
            data = dest.read_bytes()
        elif not allow_download:
            raise ValueError("Imagem ausente: " + item["storage_path"])
        else:
            data = download(item["storage_path"])
            if len(data) != item["bytes"] or sha(data) != item["sha256"]:
                raise ValueError("Download diverge do original: " + item["storage_path"])
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        if len(data) != item["bytes"] or sha(data) != item["sha256"]:
            raise ValueError("Imagem divergente: " + item["storage_path"])
        if item.get("storage_etag_md5") and md5(data) != item["storage_etag_md5"]:
            raise ValueError("MD5 diverge do eTag do Storage: " + item["storage_path"])
    extra = " (MD5 conferido com o Storage)" if all(i.get("storage_etag_md5") for i in manifest["images"]) else ""
    print(f"{root.name}: conferidos {len(snapshot['products'])} produtos e {len(expected)} fotos originais{extra}.")


def download(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as response:
        if not response.headers.get_content_type().startswith("image/"):
            raise ValueError("Resposta não é imagem")
        return response.read(8 * 1024 * 1024 + 1)


def create(root, source, reuse, etags_file):
    if root.exists() and any(root.iterdir()):
        raise SystemExit(f"{root} já existe e não é vazia; não sobrescrevo cópias.")
    data = json.loads(Path(source).read_text())
    products = [{k: v for k, v in p.items() if k != "active"} for p in data["products"]]
    categories = [{k: c[k] for k in ("id", "name", "slug", "sort_order")} for c in data["categories"]]
    now = datetime.now(timezone.utc).isoformat()
    snapshot = {"scope": "public_storefront_only", "project": "Francine Furini Store", "products": products, "categories": categories, "captured_at": now}
    etags = json.loads(Path(etags_file).read_text()) if etags_file else {}
    old_hash = {}
    if reuse:
        old = json.loads((Path(reuse) / "manifest.json").read_text())
        old_hash = {i["storage_path"]: (Path(reuse) / i["file"], i) for i in old["images"]}
    paths = [i["storage_path"] for p in products for i in sorted(p["product_images"], key=lambda x: x["sort_order"])]
    images = []
    root.mkdir(parents=True, exist_ok=True)
    for path in paths:
        if not PATH_RE.fullmatch(path):
            raise ValueError("Caminho de imagem inválido")
        if path in old_hash and old_hash[path][0].exists():
            blob = old_hash[path][0].read_bytes()
            if sha(blob) != old_hash[path][1]["sha256"]:
                raise ValueError("Foto da cópia anterior divergente: " + path)
        else:
            blob = download(path)
        etag = etags.get(path, "").strip('"')
        if etag and md5(blob) != etag:
            raise ValueError("Foto diverge do eTag atual do Storage: " + path)
        dest = root / "images" / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(blob)
        item = {"storage_path": path, "file": "images/" + path, "bytes": len(blob), "sha256": sha(blob),
                "content_type": EXT_TYPE.get(Path(path).suffix.lower(), "application/octet-stream")}
        if etag:
            item["storage_etag_md5"] = etag
        images.append(item)
    cat_bytes = (json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    (root / "catalogo.json").write_bytes(cat_bytes)
    manifest = {"captured_at": now, "scope": "public_storefront_only", "products": len(products), "variants": sum(len(p["product_variants"]) for p in products),
                "categories": len(categories), "images": images, "catalog_sha256": sha(cat_bytes)}
    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verify", action="store_true", help="Somente conferir arquivos locais, sem rede")
    parser.add_argument("--dir", help="Pasta da cópia (padrão: a mais recente)")
    parser.add_argument("--create", metavar="CATALOGO_JSON")
    parser.add_argument("--reuse", metavar="PASTA_ANTIGA")
    parser.add_argument("--etags", metavar="ETAGS_JSON")
    args = parser.parse_args()
    root = Path(args.dir).resolve() if args.dir else latest_dir()
    if args.create:
        if not args.dir:
            raise SystemExit("--create exige --dir")
        create(root, args.create, args.reuse, args.etags)
    verify(root, allow_download=not args.verify)


if __name__ == "__main__":
    main()
