declare module 'react-native' {
  import type { ComponentType, ReactNode } from 'react';

  export const Platform: { OS: 'ios' | 'android' | 'web' | string };

  export const StyleSheet: {
    create<T extends Record<string, unknown>>(styles: T): T;
    hairlineWidth: number;
  };

  export const View: ComponentType<{ style?: unknown; children?: ReactNode }>;
  export const Text: ComponentType<{
    style?: unknown;
    children?: ReactNode;
    numberOfLines?: number;
  }>;
  export const TextInput: ComponentType<Record<string, unknown>>;
  export const Pressable: ComponentType<Record<string, unknown>>;
  export const ScrollView: ComponentType<Record<string, unknown>>;
  export const Modal: ComponentType<Record<string, unknown>>;
  export const KeyboardAvoidingView: ComponentType<Record<string, unknown>>;
  export const ActivityIndicator: ComponentType<Record<string, unknown>>;
}

declare module '@react-native-community/netinfo' {
  const NetInfo: {
    fetch: () => Promise<{
      isConnected?: boolean | null;
      isInternetReachable?: boolean | null;
      type?: string;
      details?: {
        isConnectionExpensive?: boolean | null;
        cellularGeneration?: string | null;
      };
    }>;
  };
  export default NetInfo;
}
