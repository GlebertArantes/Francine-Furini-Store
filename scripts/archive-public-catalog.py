#!/usr/bin/env python3
"""Arquiva somente fotos públicas e verifica a cópia datada; nunca acessa dados pessoais."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parent.parent / "backups/catalogo/2026-10-29"
BASE = "https://txgatyftvtpkgqlncxju.supabase.co/storage/v1/object/public/product-images/"

def digest(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Somente conferir arquivos locais, sem rede")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "manifest.json").read_text())
    snapshot = json.loads((ROOT / "catalogo.json").read_text())
    if digest((ROOT / "catalogo.json").read_bytes()) != manifest["catalog_sha256"]:
        raise ValueError("Catálogo diverge do manifesto")
    expected = {i["storage_path"] for p in snapshot["products"] for i in p["product_images"]}
    if expected != {i["storage_path"] for i in manifest["images"]}:
        raise ValueError("Manifesto não corresponde às imagens do catálogo")
    for item in manifest["images"]:
        path = item["storage_path"]
        if not re.fullmatch(r"products/[a-f0-9-]{36}/[a-zA-Z0-9_.-]+", path):
            raise ValueError("Caminho de imagem inválido")
        if item["file"] != "images/" + path:
            raise ValueError("Destino inválido")
        dest = ROOT / item["file"]
        if dest.exists():
            data = dest.read_bytes()
        elif args.verify:
            raise ValueError("Imagem ausente: " + path)
        else:
            with urllib.request.urlopen(BASE + path, timeout=60) as response:
                if not response.headers.get_content_type().startswith("image/"):
                    raise ValueError("Resposta não é imagem")
                data = response.read(8 * 1024 * 1024 + 1)
            if len(data) != item["bytes"] or digest(data) != item["sha256"]:
                raise ValueError("Download diverge do original: " + path)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        if len(data) != item["bytes"] or digest(data) != item["sha256"]:
            raise ValueError("Imagem divergente: " + path)
    print(f"Conferidos {len(snapshot['products'])} produtos e {len(expected)} fotos originais.")

if __name__ == "__main__":
    main()
