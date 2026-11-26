import {shrinkImage} from './js/lib/image-resize.js';
const result=document.getElementById('result');
document.getElementById('run').onclick=async()=>{
try {
 const canvas=document.createElement('canvas');canvas.width=3500;canvas.height=2500;
 const ctx=canvas.getContext('2d'), pixels=ctx.createImageData(3500,2500);let seed=123;
 for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)|0;pixels.data[i]=seed>>>24;pixels.data[i+1]=seed>>>16&255;pixels.data[i+2]=seed>>>8&255;pixels.data[i+3]=255;}
 ctx.putImageData(pixels,0,0);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));canvas.width=canvas.height=0;
 const input=new File([blob],'foto-grande.png',{type:'image/png'});
 result.textContent=`Original: ${input.size} bytes\n`;
 if(input.size<=8*1024*1024)throw Error('Fixture menor que 8 MB');
 for(const [label,env] of [['Normal',globalThis],['Sem createImageBitmap',{document,Image,URL,File}],['createImageBitmap rejeita',{document,Image,URL,File,createImageBitmap:async()=>{throw Error('unsupported');}}]]) {
 const file=await shrinkImage(input,env);const image=await createImageBitmap(file);
 if(file.size>8*1024*1024||!file.size||image.width!==2400||image.height!==1714)throw Error('Resultado inválido');
 result.textContent+=`${label}: OK — ${file.size} bytes, ${image.width} × ${image.height}, ${file.type}\n`;image.close();
 }
 result.textContent+='Todos os cenários passaram.';
}catch(e){result.textContent+='FALHOU: '+e.message;}
};
