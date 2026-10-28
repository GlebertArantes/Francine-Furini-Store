// Fixture temporária apenas da branch de validação, removida antes de publicar.
import { editPhoto } from "./lib/photo-editor.js";
import { photoPicker } from "./views/products.js";
const canvas = document.createElement("canvas");canvas.width=1200;canvas.height=900;
const c=canvas.getContext("2d");
for(const [color,y,label] of [["#edc8aa",0,"TOPO"],["#8caa9c",300,"CENTRO"],["#786e87",600,"BASE"]]) {
  c.fillStyle=color;c.fillRect(0,y,1200,300);c.fillStyle="#212121";c.font="bold 70px sans-serif";c.fillText(label,100,y+170);
}
c.strokeStyle="#ffffff";c.lineWidth=12;c.strokeRect(20,20,1160,860);
const source = new File([await new Promise(r=>canvas.toBlob(r,"image/png"))],"foto-sintetica.png",{type:"image/png"});
const picker=photoPicker();document.querySelector("#picker-check").append(picker.el);
const transfer=new DataTransfer();transfer.items.add(source);const input=picker.el.querySelector('input[type="file"]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
document.querySelector("#check-queue").addEventListener("click",()=>{const it=picker.queue.items[0];document.querySelector("#queue-result").textContent=it?`Seleção: ${it.file.name}; original preservado: ${it.originalFile===source}; ajuste: ${it.edit ? 'sim':'não'}; pronta: ${it.check.ok}.`:'Fila vazia.';});
let saved=null,url=null;
document.querySelector("#open-editor").addEventListener("click",async()=>{
 try {
  const r=await editPhoto(source,saved);
  if(!r){document.querySelector("#test-result").textContent="Cancelado: arquivo anterior preservado.";return;}
  saved=r.state;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(r.file);
  document.querySelector("#result-photo").src=url;
  document.querySelector("#test-result").textContent=`Aplicado: ${r.file.name}, ${r.file.type}, ${r.file.size} bytes. Zoom ${Math.round(r.state.zoom*100)}%; giro ${r.state.rotation}°.`;
 } catch {document.querySelector("#test-result").textContent="Falha no editor.";}
});
