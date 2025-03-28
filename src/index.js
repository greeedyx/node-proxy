const http = require('http');
const net = require('net');
const url = require('url');

const TIMEOUT = 30000;
const PORT = 3128;

const server = http.createServer((clientReq, clientRes) => {
  // 解析目标服务器地址（直接使用客户端请求的完整 URL）
  const target = url.parse(clientReq.url);

  delete clientReq.headers['proxy-connection'];
  delete clientReq.headers['proxy-authorization'];

  // 创建代理请求（无任何过滤条件）
  const proxyReq = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    path: target.path,
    method: clientReq.method,
    headers: clientReq.headers
  }, (proxyRes) => {
    // 将目标服务器的响应回传客户端
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    const proxyToClient = proxyRes.pipe(clientRes, { end: false });
    proxyToClient.on('error', (err) => {
      console.error('HTTP响应管道错误:', err);
      clientRes.destroy();
    });
    // HTTP响应管道添加错误处理
    proxyRes.on('error', (err) => {
      clientRes.destroy();
    });
    // 响应流超时
    proxyRes.setTimeout(TIMEOUT);
    proxyRes.on('timeout', () => {
      proxyRes.destroy();
      clientRes.destroy();
    });
  });

  proxyReq.setTimeout(TIMEOUT);
  proxyReq.on('timeout', () => {
    proxyReq.abort();
    clientRes.writeHead(504, { 'Content-Type': 'text/plain' });
    clientRes.end('Gateway Timeout');
  });

  clientReq.on('error', (err) => {
    proxyReq.abort();
  });

  // HTTP代理请求错误处理
  proxyReq.on('error', (err) => {
    // console.error('Proxy request error:', err);
    clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
    clientRes.end('Bad Gateway');
  });

  // 转发客户端请求体
  clientReq.pipe(proxyReq);
});

// 处理 HTTPS 请求（CONNECT 方法）
server.on('connect', (req, clientSocket, head) => {
  const target = url.parse(`http://${req.url}`);
  console.log(`连接服务器：${target.hostname}:${target.port}`);
  const srvSocket = net.connect(target.port || 443, target.hostname);
  // 提前监听错误
  srvSocket.on('error', (err) => {
    // console.error('连接目标服务器失败:', err);
    clientSocket.destroy();
    srvSocket.destroy();
  });
  srvSocket.once('connect', () => { // 使用 once 避免重复监听
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    srvSocket.write(head);
    srvSocket.pipe(clientSocket, { end: false });
    clientSocket.pipe(srvSocket, { end: false });
  });
  clientSocket.on('error', (err) => {
    // console.error('Client socket error:', err);
    srvSocket.destroy();
    clientSocket.destroy();
  });

  srvSocket.on('close', () => {
    srvSocket.removeAllListeners();
  });
  clientSocket.on('close', () => {
    clientSocket.removeAllListeners();
  });
});

server.listen(PORT, () => {
  console.log(`全局代理服务器运行在 ${PORT} 端口`);
});
