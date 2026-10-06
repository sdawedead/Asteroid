const http=require('http');
const fs=require('fs');
const path=require('path');
const root=__dirname;
const port=8095;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  let url=decodeURIComponent(req.url.split('?')[0]);
  if(url==='/')url='/index.html';
  const file=path.join(root,url.replace(/^\/+/,''));
  if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden')}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found')}
    res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);
  });
}).listen(port,'0.0.0.0',()=>console.log(`ASTEROID WALK listening on http://0.0.0.0:${port}`));
