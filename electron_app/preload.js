const { contextBridge } = require('electron');
const { io } = require('socket.io-client');

const socket = io('http://localhost:5000', {
  reconnection: true,
  reconnectionDelay: 2000,
  reconnectionAttempts: Infinity,
  transports: ['websocket'],
});

contextBridge.exposeInMainWorld('socketAPI', {
  onPayment: (callback) => socket.on('new payment', callback),
  onConnect: (callback) => socket.on('connect', callback),
  onDisconnect: (callback) => socket.on('disconnect', callback),
});
