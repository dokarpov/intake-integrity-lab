export class JsonAlertSink {
  constructor({ write = line => process.stderr.write(`${line}\n`) } = {}) { this.write=write; }
  async emit(alert) { this.write(JSON.stringify({type:'compliance_control_alert',...alert})); }
}
