import { io } from 'socket.io-client';

let socket = null;

/**
 * One shared connection for the whole app. The session cookie authenticates it,
 * so nothing extra is sent from the client.
 */
export function getSocket() {
  if (!socket) {
    socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
