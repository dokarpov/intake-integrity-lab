import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class Rfc3161TimestampClient {
  constructor({ tsaUrl, openssl='openssl', caFile, fetchImpl=globalThis.fetch }={}) {
    if(!tsaUrl)throw new Error('tsa_url_required'); this.tsaUrl=tsaUrl; this.openssl=openssl; this.caFile=caFile; this.fetchImpl=fetchImpl;
  }
  async timestamp(bytes) {
    const dir=mkdtempSync(join(tmpdir(),'ledger-tsa-'));
    try {
      const data=join(dir,'data.bin'), req=join(dir,'request.tsq'); writeFileSync(data,bytes);
      execFileSync(this.openssl,['ts','-query','-data',data,'-sha256','-cert','-out',req]);
      const response=await this.fetchImpl(this.tsaUrl,{method:'POST',headers:{'content-type':'application/timestamp-query'},body:readFileSync(req)});
      if(!response.ok)throw new Error(`tsa_http_${response.status}`);
      const token=Buffer.from(await response.arrayBuffer());
      return {format:'rfc3161',tsaUrl:this.tsaUrl,tokenBase64:token.toString('base64')};
    } finally { rmSync(dir,{recursive:true,force:true}); }
  }
  verify(bytes, tokenBase64) {
    const dir=mkdtempSync(join(tmpdir(),'ledger-tsa-'));
    try { const data=join(dir,'data.bin'),resp=join(dir,'response.tsr');writeFileSync(data,bytes);writeFileSync(resp,Buffer.from(tokenBase64,'base64'));const args=['ts','-verify','-data',data,'-in',resp];if(this.caFile)args.push('-CAfile',this.caFile);execFileSync(this.openssl,args,{stdio:'pipe'});return true;} catch {return false;} finally {rmSync(dir,{recursive:true,force:true});}
  }
}
