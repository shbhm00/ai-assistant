declare const __DEV__: boolean | undefined;

export function isDev(): boolean {
  return typeof __DEV__ === 'undefined' ? true : __DEV__;
}
