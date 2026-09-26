// Connectivity hook. Distinguishes "no Internet" from "Internet reachable".
// Later phases can extend this to also probe API reachability separately.

import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export interface ConnectivityState {
  online: boolean;
  isConnected: boolean;
  isInternetReachable: boolean;
}

export function useConnectivity(): ConnectivityState {
  const [state, setState] = useState<{ isConnected: boolean; isInternetReachable: boolean }>({
    isConnected: true,
    isInternetReachable: true,
  });

  useEffect(() => {
    const apply = (isConnected: boolean, reachable: boolean | null) => {
      setState({
        isConnected: !!isConnected,
        // reachable === null means "unknown yet" -> treat as reachable.
        isInternetReachable: reachable !== false,
      });
    };

    NetInfo.fetch().then((s) => apply(!!s.isConnected, s.isInternetReachable));
    const unsub = NetInfo.addEventListener((s) => apply(!!s.isConnected, s.isInternetReachable));
    return unsub;
  }, []);

  return {
    online: state.isConnected && state.isInternetReachable,
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
  };
}
