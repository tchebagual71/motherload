// Entry point: boot the app; a failure before the UI mounts shows a plain message in #boot.
import { boot, showBootMessage } from './app/boot';

boot().catch((e: unknown) => {
  console.error('HoleFactory failed to start', e);
  showBootMessage('HoleFactory could not start. Reload to try again.');
});
