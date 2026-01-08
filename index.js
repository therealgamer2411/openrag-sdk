const io = require('socket.io-client');
const SimplePeer = require('simple-peer');
const wrtc = require('@roamhq/wrtc');

class OpenRAG {
    constructor(config) {
        if (!config || !config.apiKey) throw new Error("OpenRAG: API Key is required.");

        this.apiKey = config.apiKey;
        this.serverUrl = config.serverUrl || 'https://openrag-grid.koyeb.app'; 
        this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        this.socket = null;
        this.isConnected = false;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = io(this.serverUrl, {
                auth: { token: this.apiKey },
                reconnection: true,
                rejectUnauthorized: false
            });

            this.socket.on('connect', () => { this.isConnected = true; resolve(true); });

            this.socket.on('ICE_CONFIG', (data) => {
                if(data && data.iceServers) this.iceServers = data.iceServers;
            });

            this.socket.on('connect_error', (err) => reject(new Error(`Connection Failed: ${err.message}`)));
        });
    }

    async fetch(targetUrl) {
        if (!this.isConnected) throw new Error("Not connected.");

        // فحص الأمان المصري
        const forbidden = ['.gov.eg', '.mil.eg', 'porn', 'xxx'];
        if (forbidden.some(d => targetUrl.toLowerCase().includes(d))) {
            throw new Error("Blocked: Restricted Content.");
        }

        return new Promise((resolve, reject) => {
            this.socket.emit('REQUEST_PEER');

            const onPeerFound = ({ targetId }) => {
                this.socket.off('PEER_FOUND', onPeerFound);
                this._startP2P(targetId, targetUrl, resolve, reject);
            };

            const onNoPeers = () => {
                this.socket.off('PEER_FOUND', onPeerFound);
                reject(new Error("No nodes available."));
            };

            this.socket.on('PEER_FOUND', onPeerFound);
            this.socket.once('NO_PEERS_AVAILABLE', onNoPeers);

            setTimeout(() => {
                this.socket.off('PEER_FOUND', onPeerFound);
                this.socket.off('NO_PEERS_AVAILABLE', onNoPeers);
                reject(new Error("Timeout: No Peer Found."));
            }, 45000);
        });
    }

    _startP2P(targetId, targetUrl, resolve, reject) {
        const p = new SimplePeer({
            initiator: true,
            trickle: true, 
            wrtc: wrtc,
            // 🔥 إعدادات لتسريع الاتصال ومنع الأخطاء
            offerToReceiveAudio: false,
            offerToReceiveVideo: false,
            config: { iceServers: this.iceServers }
        });

        p.on('signal', (data) => {
            // 🔥 تنظيف الإشارة قبل إرسالها للهاتف
            if (data.type === 'candidate' && !data.candidate) return; // تجاهل المرشحات الفارغة
            this.socket.emit('SIGNAL_MESSAGE', { targetId, signal: data });
        });

        const onSignal = (data) => {
            if (data.senderId === targetId) {
                // 🔥 الفلتر السحري: تجاهل ما لا يفهمه Node.js
                if (data.signal.candidate === null) return; 
                if (data.signal.type === 'candidate' && !data.signal.candidate) return;
                
                try {
                    p.signal(data.signal);
                } catch (e) {
                    // تجاهل أخطاء "unsupported candidate" بصمت لنكمل المحاولة
                    // console.log("⚠️ Ignored incompatible signal segment.");
                }
            }
        };
        this.socket.on('SIGNAL_RECEIVED', onSignal);

        p.on('connect', () => {
            // console.log("⚡ Tunnel Established!");
            p.send(JSON.stringify({ url: targetUrl }));
        });

        p.on('data', (data) => {
            const response = JSON.parse(data.toString());
            this.socket.off('SIGNAL_RECEIVED', onSignal);
            p.destroy();

            if (response.status === 200) resolve(response.body);
            else reject(new Error(response.error || "Fetch Failed"));
        });

        p.on('error', (err) => {
            this.socket.off('SIGNAL_RECEIVED', onSignal);
            if (err.code === 'ERR_DATA_CHANNEL') return;
            reject(err);
        });

        setTimeout(() => {
            if(!p.connected) {
                 p.destroy();
                 this.socket.off('SIGNAL_RECEIVED', onSignal);
                 reject(new Error("Handshake Timeout."));
            }
        }, 40000);
    }

    disconnect() {
        if (this.socket) this.socket.disconnect();
    }
}

module.exports = OpenRAG;
