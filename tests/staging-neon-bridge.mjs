/**
 * Local-only HTTP bridge to test the exact bundled Neon Function, not a
 * substitute application server. This test server binds 127.0.0.1 only.
 */
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
if(process.env.NODE_ENV!=='staging')throw Error('staging_only');
if(!process.env.DATABASE_URL||!process.env.STAGING_ACCESS_TOKEN)throw Error('test_config_missing');
const file=process.env.NEON_E2E_BUNDLE||'/tmp/acorde-neon-e2e.mjs';
const handler=(await import(pathToFileURL(resolve(file)).href)).default;
if(typeof handler?.fetch!=='function')throw Error('invalid_neon_function_bundle');
const host='127.0.0.1',port=Number(process.env.NEON_E2E_PORT||8788);
createServer(async(req,res)=>{
  try{
    const chunks=[];let length=0;
    for await(const chunk of req){
      length+=chunk.length;
      if(length>1000000){res.writeHead(413);res.end('too large');return}
      chunks.push(chunk);
    }
    const input=new Request('http://'+host+':'+port+(req.url||'/'),{
      method:req.method,headers:req.headers,
      body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)
    });
    const output=await handler.fetch(input);
    res.writeHead(output.status,Object.fromEntries(output.headers.entries()));
    res.end(req.method==='HEAD'?undefined:Buffer.from(await output.arrayBuffer()));
  }catch(e){console.error('Neon CI bridge error:',e.message);res.writeHead(500);res.end('test bridge error')}
}).listen(port,host,()=>console.log('Neon Function CI bridge '+host+':'+port));
