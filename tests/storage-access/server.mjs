import https from 'node:https';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const plain=process.env.WINDOWLLM_STORAGE_TEST_HTTP==='1',scheme=plain?'http':'https';
const handler=async(request,response)=>{
 response.setHeader('Access-Control-Allow-Origin',`${scheme}://windowllm.localhost:43140`);
 response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
 if(request.method==='OPTIONS'){response.writeHead(204);response.end();return;}
 if(request.url==='/'){
  response.setHeader('Content-Type','text/html');response.end(await readFile(new URL('client.html',import.meta.url)));return;
 }
 if(request.headers.authorization!=='Bearer windowllm-storage-access-test-key'){
  response.writeHead(401,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:'Missing test credential. Unpartitioned IndexedDB key restoration failed.'}}));return;
 }
 response.setHeader('Content-Type','application/json');
 if(request.url==='/v1/models'){response.end(JSON.stringify({data:[{id:'gpt-storage-access-model',object:'model',owned_by:'fixture'}]}));return;}
 if(request.url==='/v1/chat/completions'){
  for await(const _chunk of request){}
  response.end(JSON.stringify({id:'storage-access-proof',object:'chat.completion',model:'gpt-storage-access-model',choices:[{index:0,message:{role:'assistant',content:'Connected through hidden iframe'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));return;
 }
 response.writeHead(404);response.end('{}');
};
const server=plain?http.createServer(handler):https.createServer({key:await readFile(new URL('.certs/key.pem',root)),cert:await readFile(new URL('.certs/cert.pem',root))},handler);
server.listen(43141,'127.0.0.1',()=>console.log(`Storage access test page: ${scheme}://test.localhost:43141/`));
