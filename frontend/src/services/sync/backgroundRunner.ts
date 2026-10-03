// Framework-free orchestration, exercised without mounting React or navigation.
export interface BackgroundPorts {
  initialize(): Promise<void>;
  restore(): Promise<{ token: string | null; session: unknown | null }>;
  pendingCount(): Promise<number>;
  sync(token: string): Promise<{ authError: boolean }>;
  suspendAuth(token: string | null): Promise<void>;
}
export async function executeBackgroundSync(ports: BackgroundPorts): Promise<"done" | "retry" | "auth"> {
  try {
    await ports.initialize();
    if (await ports.pendingCount() === 0) return "done";
    const { token, session } = await ports.restore();
    if (!token || !session) {
      await ports.suspendAuth(token);
      return "auth";
    }
    const result = await ports.sync(token);
    if (result.authError) {
      await ports.suspendAuth(token);
      return "auth";
    }
    return await ports.pendingCount() > 0 ? "retry" : "done";
  } catch {
    // An unexpected exception never authorizes deleting queued data.
    return "retry";
  }
}
