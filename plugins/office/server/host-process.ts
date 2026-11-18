export interface HostProcessPorts {
  /** This process and its parent. */
  pid: number;
  ppid: number;
  /** True when the office runs in the daemon's own process (a built-in of the fork). */
  inDaemon: boolean;
}

/**
 * The process the host's clean-up starts its protected ancestors from. A built-in is the daemon.
 * An installed plugin is a subprocess of the daemon worker (the process that listens on the port),
 * with the supervisor one step above that: its parent leads to the daemon, and the clean-up walks
 * up from there, which covers the supervisor too.
 */
export function daemonPid(ports: HostProcessPorts): number {
  if (ports.inDaemon) return ports.pid;
  return ports.ppid > 0 ? ports.ppid : ports.pid;
}
