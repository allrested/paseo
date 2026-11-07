import { join } from "node:path";
import { isCurrentPidSpace, listPidFiles, readPidRecord, readStartTime } from "../pid-files.js";
import { walkProcessTree } from "./procfs.js";

// shared-mcp names each server's process group in <PASEO_HOME>/shared-mcp/run/<id>.pid. This only
// reads those files: it never writes, removes or signals anything they name. A record counts when
// it is from this pid space and its leader still runs with the recorded start time; a server whose
// leader exited is missed, and its processes count under their parent's owner instead.
export function readSharedMcpPids(runDir: string, procRoot: string): Set<number> {
  const pids = new Set<number>();
  for (const name of listPidFiles(runDir)) {
    try {
      const record = readPidRecord(join(runDir, name));
      if (record === null || record.pgid <= 1 || record.startTime === null) continue;
      if (!isCurrentPidSpace(record, procRoot)) continue;
      if (readStartTime(record.pgid, procRoot) !== record.startTime) continue;
      for (const { pid } of walkProcessTree(record.pgid, procRoot)) pids.add(pid);
    } catch (error) {
      // One unreadable record must not hide the rest. walkProcessTree throws only on errors other
      // than a vanished process, such as EACCES.
      console.error(`resource-manager: skipped shared-mcp pid file ${name}`, error);
    }
  }
  return pids;
}
