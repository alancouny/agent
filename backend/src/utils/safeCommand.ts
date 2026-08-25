/** Sanitise a user-provided command string to reject shell metacharacter injection. */
export function assertSafeCommand(command: string): void {
  if (!command.trim()) throw new Error('command must not be empty');
  if (/[;|&<>`]|\$\(|&&|\|\|/.test(command)) {
    throw new Error('command contains shell metacharacters; use args for parameters');
  }
  const firstToken = command.trim().split(/\s+/)[0];
  if (['sh', 'bash', 'zsh', 'cmd', 'powershell', 'pwsh'].includes(firstToken)) {
    throw new Error(`cannot use "${firstToken}" as a command wrapper; specify the binary and pass flags via args`);
  }
}

/** Mask internal paths and stack traces before exposing an error to the client. */
export function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    // Strip absolute paths that may leak project structure
    const stripped = msg.replace(/\/[^\s]+/g, '[path]');
    return `An error occurred: ${stripped}`;
  }
  return 'An unknown error occurred';
}
