/* Shared reconnecting transport with midpoint clock synchronization. */
window.Chorus = {
  connect(receive) {
    let socket, timer, retry, bestRtt = Infinity;
    function open() {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socket.onopen = () => {
        bestRtt = Infinity;
        receive({ type: 'connection', connected: true });
        const ping = () => { if (socket.readyState === 1) socket.send(JSON.stringify({type:'ping',sent:Date.now()})); };
        ping(); timer = setInterval(ping, 3000);
      };
      socket.onmessage = ({data}) => {
        try {
          const event = JSON.parse(data);
          if (event.type === 'pong') {
            const rtt = Date.now() - event.sent;
            if (rtt <= bestRtt + 5) { bestRtt = Math.min(bestRtt, rtt); receive({type:'clock',offset:event.serverTime - (event.sent + rtt/2)}); }
          } else receive(event);
        } catch (error) { console.error('Chorus event failed', error); }
      };
      socket.onclose = () => { clearInterval(timer); receive({type:'connection',connected:false}); retry=setTimeout(open,1500); };
      socket.onerror = () => socket.close();
    }
    open();
    addEventListener('pagehide', () => { clearTimeout(retry);clearInterval(timer);socket.onclose=null;socket.close(); }, {once:true});
  },
  async post(path, body = {}) {
    const response = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.json();
  }
};
