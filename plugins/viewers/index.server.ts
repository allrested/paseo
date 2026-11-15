// The viewers read their file through the app's file handle; nothing runs in the daemon.
export default function contribute(): () => void {
  return () => {};
}
