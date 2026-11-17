package com.himbeerhof.tv;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/**
 * Tiny web server so the playlist can be sent from a phone on the same Wi-Fi
 * instead of typing a long link with the TV remote.
 */
public class PhoneServer {
    public interface Listener {
        void onUrl(String url);
        void onPlaylistText(String text);
    }

    private ServerSocket server;
    private volatile boolean running;
    private final Listener listener;
    private int port = -1;

    public PhoneServer(Listener l) { this.listener = l; }

    public int getPort() { return port; }

    public void start() {
        if (running) return;
        running = true;
        Thread t = new Thread(() -> {
            for (int p = 8080; p <= 8090 && server == null; p++) {
                try { server = new ServerSocket(p); port = p; } catch (Exception ignored) { }
            }
            if (server == null) { running = false; return; }
            while (running) {
                try {
                    Socket s = server.accept();
                    new Thread(() -> handle(s)).start();
                } catch (Exception e) {
                    if (!running) break;
                }
            }
        }, "phone-server");
        t.setDaemon(true);
        t.start();
    }

    public void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (Exception ignored) { }
        server = null;
        port = -1;
    }

    private void handle(Socket s) {
        try {
            s.setSoTimeout(30000);
            InputStream in = s.getInputStream();
            String requestLine = readLine(in);
            if (requestLine == null) { s.close(); return; }
            int contentLength = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int c = line.indexOf(':');
                if (c > 0 && line.substring(0, c).trim().equalsIgnoreCase("content-length")) {
                    try { contentLength = Integer.parseInt(line.substring(c + 1).trim()); } catch (Exception ignored) { }
                }
            }
            String msg = null;
            if (requestLine.startsWith("POST")) {
                byte[] body = new byte[Math.max(0, Math.min(contentLength, 60 * 1024 * 1024))];
                int off = 0;
                while (off < body.length) {
                    int r = in.read(body, off, body.length - off);
                    if (r < 0) break;
                    off += r;
                }
                String form = new String(body, 0, off, StandardCharsets.UTF_8);
                String url = null, m3u = null;
                for (String pair : form.split("&")) {
                    int eq = pair.indexOf('=');
                    if (eq < 0) continue;
                    String k = pair.substring(0, eq);
                    String v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                    if (k.equals("url")) url = v.trim();
                    else if (k.equals("m3u")) m3u = v;
                }
                if (m3u != null && m3u.contains("#EXTINF")) {
                    listener.onPlaylistText(m3u);
                    msg = "Playlist-ul a fost trimis la televizor ✔";
                } else if (url != null && !url.isEmpty()) {
                    listener.onUrl(url);
                    msg = "Linkul a fost trimis la televizor ✔";
                } else {
                    msg = "Nu am primit nimic. Pune un link sau alege un fișier .m3u.";
                }
            }
            send(s.getOutputStream(), page(msg));
            s.close();
        } catch (Exception e) {
            try { s.close(); } catch (Exception ignored) { }
        }
    }

    private static String readLine(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
        }
        if (c == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static void send(OutputStream out, String html) throws java.io.IOException {
        byte[] b = html.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: "
                + b.length + "\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    private static String page(String msg) {
        return "<!DOCTYPE html><html lang=ro><head><meta charset=utf-8>"
                + "<meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<title>Himbeer TV</title><style>"
                + "body{font-family:system-ui,sans-serif;background:#14171d;color:#fff;margin:0;padding:20px;max-width:560px}"
                + "h1{color:#e53958;margin:0 0 16px}label{display:block;margin:18px 0 6px;color:#ccc}"
                + "input[type=text]{width:100%;box-sizing:border-box;font-size:17px;padding:12px;border-radius:8px;border:0}"
                + "button{margin-top:22px;width:100%;font-size:18px;padding:14px;border:0;border-radius:8px;background:#e53958;color:#fff;font-weight:bold}"
                + ".ok{background:#1f3d2a;padding:12px;border-radius:8px;margin-bottom:12px}"
                + "small{color:#999}</style></head><body>"
                + "<h1>Himbeer TV</h1>"
                + (msg != null ? "<div class=ok>" + msg + "</div>" : "")
                + "<form method=post id=f>"
                + "<label>Link playlist M3U</label>"
                + "<input type=text name=url placeholder='http://...' autocomplete=off>"
                + "<label>sau fișier .m3u de pe telefon</label>"
                + "<input type=file id=file accept='.m3u,.m3u8,audio/x-mpegurl,application/x-mpegurl,text/plain,*/*'>"
                + "<input type=hidden name=m3u id=m3u>"
                + "<button type=submit>Trimite la televizor</button>"
                + "<p><small>Telefonul și televizorul trebuie să fie pe aceeași rețea Wi-Fi.</small></p>"
                + "</form><script>"
                + "document.getElementById('file').onchange=function(e){var f=e.target.files[0];if(!f)return;"
                + "var r=new FileReader();r.onload=function(){document.getElementById('m3u').value=r.result;};r.readAsText(f);};"
                + "</script></body></html>";
    }

    public static String localIp() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) { }
        return null;
    }
}
