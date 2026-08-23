/**
 * app/App.ts
 *
 * Entry point. Starts the application by delegating to Bootstrap. Contains
 * NO business logic — its only responsibility is "start the engine".
 */

import { Bootstrap, type BootstrappedApp, type BootstrapOptions } from "./Bootstrap";

export class App {
  private static instance: BootstrappedApp | null = null;

  /** Start the application. Resolves once the engine is fully running. */
  public static async start(options: BootstrapOptions = {}): Promise<BootstrappedApp> {
    if (App.instance) {
      // eslint-disable-next-line no-console
      console.warn("[App] Already started — returning existing instance.");
      return App.instance;
    }
    const bootstrap = new Bootstrap();
    App.instance = await bootstrap.run(options);
    return App.instance;
  }

  /** Shut down the application and release all resources. */
  public static async stop(): Promise<void> {
    if (!App.instance) return;
    await App.instance.shutdown();
    App.instance = null;
  }
}
