"use client";

import { FormEvent, useState } from "react";
import { saveAccessCode } from "@/lib/api";

export function DeploymentControls() {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    try {
      saveAccessCode(code);
      setCode("");
      setMessage("Access code saved for this tab. Evidence requests will retry automatically.");
    } catch {
      setMessage("Session storage is unavailable. Enable storage for this site and try again.");
    }
  }

  function clear() {
    try {
      saveAccessCode("");
      setCode("");
      setMessage("Saved access code cleared.");
    } catch { setMessage("Could not clear storage. Close this tab to end the session."); }
  }

  return <div className="deployment-controls">
    <details className="access-control"><summary>Private deployment access</summary>
      <form onSubmit={save}>
        <p>Use the code provided by the deployment owner. It is kept only in this tab&apos;s session.</p>
        <label htmlFor="deployment-code">Deployment access code</label>
        <input id="deployment-code" type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} required maxLength={512} />
        <div><button type="submit">Save access code</button><button type="button" onClick={clear}>Clear saved code</button></div>
        <p role="status">{message}</p>
      </form>
    </details>
  </div>;
}
