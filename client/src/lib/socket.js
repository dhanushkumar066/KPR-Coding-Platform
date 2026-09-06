import { io } from 'socket.io-client';

let socket = null;

/**
 * One shared connection for the whole app. The session cookie authenticates it,
 * so nothing extra is sent from the client.
 */
export function getSocket() {
  if (!socket) {
    // Websocket only — see the server's realtime.js. Polling would need
    // sticky sessions, which route a whole hall behind one NAT to one worker.
    socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket'] });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
