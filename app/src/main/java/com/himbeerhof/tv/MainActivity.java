package com.himbeerhof.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.PlayerView;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@OptIn(markerClass = UnstableApi.class)
public class MainActivity extends Activity {

    private static final String G_SETTINGS = "⚙  Setări / playlist";
    private static final String G_FAV = "★  Favorite";
    private static final String G_ALL = "Toate canalele";
    private static final String UA = "Mozilla/5.0 (Linux; Android 11; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 HimbeerTV";

    private ExoPlayer player;
    private PlayerView playerView;
    private View panel, info;
    private TextView status, infoName, infoGroup, channelsTitle, numberEntry;
    private ImageView infoLogo;
    private RecyclerView groupsView, channelsView;
    private final GroupAdapter groupAdapter = new GroupAdapter();
    private final ChannelAdapter channelAdapter = new ChannelAdapter();

    private SharedPreferences prefs;
    private Set<String> favs = new HashSet<>();
    private List<Channel> all = new ArrayList<>();
    private Map<String, List<Channel>> groups = new HashMap<>();
    private final List<String> groupNames = new ArrayList<>();

    private String shownGroup;
    private List<Channel> shownList = new ArrayList<>();
    private String playingGroup;
    private List<Channel> playingList;
    private int playingIndex = -1;
    private Channel playing;
    private int retries;
    private boolean forceHls;

    private final Handler h = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private PhoneServer server;
    private AlertDialog settingsDialog;
    private long lastBack;
    private final StringBuilder numBuf = new StringBuilder();
    private Runnable pendingGroup;

    private final Runnable hideInfo = () -> info.setVisibility(View.GONE);
    private final Runnable commitNumber = this::commitNumber;

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);
        prefs = getSharedPreferences("himbeertv", MODE_PRIVATE);
        favs = new HashSet<>(prefs.getStringSet("favs", Collections.emptySet()));

        playerView = findViewById(R.id.player);
        panel = findViewById(R.id.panel);
        info = findViewById(R.id.info);
        status = findViewById(R.id.status);
        infoName = findViewById(R.id.infoName);
        infoGroup = findViewById(R.id.infoGroup);
        infoLogo = findViewById(R.id.infoLogo);
        channelsTitle = findViewById(R.id.channelsTitle);
        numberEntry = findViewById(R.id.numberEntry);
        groupsView = findViewById(R.id.groups);
        channelsView = findViewById(R.id.channels);

        groupsView.setLayoutManager(new LinearLayoutManager(this));
        groupsView.setAdapter(groupAdapter);
        channelsView.setLayoutManager(new LinearLayoutManager(this));
        channelsView.setAdapter(channelAdapter);
        channelsView.setItemAnimator(null);
        groupsView.setItemAnimator(null);

        setupPlayer();

        server = new PhoneServer(new PhoneServer.Listener() {
            @Override public void onUrl(String url) {
                runOnUiThread(() -> {
                    prefs.edit().putString("url", url).apply();
                    if (settingsDialog != null) settingsDialog.dismiss();
                    refreshFromSource(true);
                });
            }
            @Override public void onPlaylistText(String text) {
                writeFile(cacheFile(), text);
                List<Channel> list = Channel.parse(text);
                runOnUiThread(() -> {
                    prefs.edit().putString("url", "local:telefon").apply();
                    if (settingsDialog != null) settingsDialog.dismiss();
                    applyChannels(list, playing == null);
                    toast(list.size() + " canale încărcate");
                });
            }
        });
        server.start();

        loadCached();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (player != null && playing != null && playingList != null) {
            play(playingGroup, playingList, playingIndex, false);
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null) player.stop();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (player != null) player.release();
        player = null;
        if (server != null) server.stop();
        io.shutdownNow();
    }

    // ------------------------------------------------------------------ player

    private void setupPlayer() {
        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        playerView.setKeepScreenOn(true);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    status.setVisibility(View.GONE);
                    retries = 0;
                }
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException e) {
                if (e.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    player.seekToDefaultPosition();
                    player.prepare();
                    return;
                }
                if (playing == null) return;
                if (retries < 3) {
                    retries++;
                    // on the first retry, try the stream as HLS (many IPTV links have no extension)
                    if (retries == 1 && !playing.url.toLowerCase().contains(".m3u8")) forceHls = true;
                    else forceHls = false;
                    showStatus("Se conectează din nou… (" + retries + ")");
                    h.postDelayed(() -> startStream(playing), 1500);
                } else {
                    forceHls = false;
                    showStatus("Canalul „" + playing.name + "” nu merge acum.\n\n"
                            + e.getErrorCodeName() + "\n\nApasă OK pentru lista de canale.");
                }
            }
        });
    }

    private void play(String groupKey, List<Channel> list, int index, boolean userAction) {
        if (list == null || list.isEmpty() || player == null) return;
        int n = list.size();
        index = ((index % n) + n) % n;
        playingGroup = groupKey;
        playingList = list;
        playingIndex = index;
        playing = list.get(index);
        if (userAction) retries = 0;
        forceHls = false;
        h.removeCallbacksAndMessages(null);
        prefs.edit().putString("last", playing.url).putString("lastGroup", groupKey).apply();
        startStream(playing);
        showInfo();
    }

    private void startStream(Channel c) {
        if (player == null || c == null) return;
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(c.userAgent != null && !c.userAgent.isEmpty() ? c.userAgent : UA)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(20000);
        if (c.referrer != null && !c.referrer.isEmpty()) {
            Map<String, String> hdr = new HashMap<>();
            hdr.put("Referer", c.referrer);
            http.setDefaultRequestProperties(hdr);
        }
        DataSource.Factory ds = new DefaultDataSource.Factory(this, http);
        MediaItem.Builder item = new MediaItem.Builder().setUri(c.url);
        String lower = c.url.toLowerCase();
        if (forceHls || lower.contains(".m3u8") || lower.contains("type=m3u8")) item.setMimeType(MimeTypes.APPLICATION_M3U8);
        else if (lower.contains(".mpd")) item.setMimeType(MimeTypes.APPLICATION_MPD);
        MediaSource ms = new DefaultMediaSourceFactory(ds).createMediaSource(item.build());
        player.setMediaSource(ms);
        player.prepare();
        player.setPlayWhenReady(true);
    }

    // ------------------------------------------------------------------ playlist

    private File cacheFile() { return new File(getFilesDir(), "playlist.m3u"); }

    private void loadCached() {
        io.execute(() -> {
            String t = readFile(cacheFile());
            List<Channel> list = t != null ? Channel.parse(t) : new ArrayList<>();
            runOnUiThread(() -> {
                if (!list.isEmpty()) applyChannels(list, true);
                String url = prefs.getString("url", null);
                if (url == null) {
                    showStatus("Bine ai venit la Himbeer TV!\n\nAdaugă playlist-ul tău M3U ca să începi.");
                    openSettings();
                } else {
                    refreshFromSource(list.isEmpty());
                }
            });
        });
    }

    private void refreshFromSource(boolean showProgress) {
        String url = prefs.getString("url", null);
        if (url == null || url.startsWith("local:")) {
            if (showProgress && all.isEmpty()) openSettings();
            return;
        }
        if (showProgress) showStatus("Se încarcă playlist-ul…");
        io.execute(() -> {
            try {
                String t = download(url);
                List<Channel> list = Channel.parse(t);
                if (list.isEmpty()) throw new Exception("Lista nu conține niciun canal.");
                writeFile(cacheFile(), t);
                runOnUiThread(() -> {
                    boolean first = playing == null;
                    applyChannels(list, first);
                    if (showProgress) toast(list.size() + " canale încărcate");
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (showProgress || all.isEmpty()) {
                        showStatus("Nu am putut încărca playlist-ul:\n" + e.getMessage()
                                + "\n\nVerifică linkul în Setări.");
                    }
                });
            }
        });
    }

    private void applyChannels(List<Channel> list, boolean autoplay) {
        all = list;
        groups = Channel.byGroup(list);
        groupNames.clear();
        groupNames.add(G_SETTINGS);
        groupNames.add(G_FAV);
        groupNames.add(G_ALL);
        groupNames.addAll(groups.keySet());
        groupAdapter.notifyDataSetChanged();

        if (playing != null) {
            // keep playing the same channel inside the new list
            String g = playingGroup;
            List<Channel> l = listFor(g);
            int i = indexOfUrl(l, playing.url);
            if (i >= 0) { playingList = l; playingIndex = i; playing = l.get(i); }
        } else if (autoplay) {
            String last = prefs.getString("last", null);
            String lastGroup = prefs.getString("lastGroup", G_ALL);
            List<Channel> l = listFor(lastGroup);
            int i = indexOfUrl(l, last);
            if (i < 0) { lastGroup = G_ALL; l = all; i = indexOfUrl(all, last); }
            if (i >= 0) {
                status.setVisibility(View.GONE);
                play(lastGroup, l, i, true);
            } else {
                status.setVisibility(View.GONE);
                showPanel();
            }
        } else {
            status.setVisibility(View.GONE);
        }
        if (panel.getVisibility() == View.VISIBLE && shownGroup != null) selectGroup(shownGroup);
    }

    private List<Channel> listFor(String g) {
        if (g == null || G_ALL.equals(g)) return all;
        if (G_SETTINGS.equals(g)) return new ArrayList<>();
        if (G_FAV.equals(g)) {
            List<Channel> l = new ArrayList<>();
            for (Channel c : all) if (favs.contains(c.url)) l.add(c);
            return l;
        }
        List<Channel> l = groups.get(g);
        return l != null ? l : new ArrayList<>();
    }

    private static int indexOfUrl(List<Channel> l, String url) {
        if (url == null || l == null) return -1;
        for (int i = 0; i < l.size(); i++) if (url.equals(l.get(i).url)) return i;
        return -1;
    }

    private static String download(String u) throws Exception {
        String url = u;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setRequestProperty("User-Agent", UA);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new Exception("Redirecționare fără adresă");
                url = new URL(new URL(url), loc).toString();
                continue;
            }
            if (code != 200) throw new Exception("Serverul a răspuns cu codul " + code);
            try (InputStream in = c.getInputStream()) {
                return readAll(in);
            } finally {
                c.disconnect();
            }
        }
        throw new Exception("Prea multe redirecționări");
    }

    private static String readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int r;
        while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
        return out.toString("UTF-8");
    }

    private static String readFile(File f) {
        if (!f.exists()) return null;
        try (InputStream in = new FileInputStream(f)) { return readAll(in); } catch (Exception e) { return null; }
    }

    private static void writeFile(File f, String text) {
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ UI

    private void showStatus(String s) {
        status.setText(s);
        status.setVisibility(View.VISIBLE);
    }

    private void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_SHORT).show(); }

    private void showInfo() {
        if (playing == null) return;
        infoName.setText(playing.number + "   " + playing.name + (favs.contains(playing.url) ? "  ★" : ""));
        infoGroup.setText(playing.group);
        loadLogo(infoLogo, playing.logo);
        info.setVisibility(View.VISIBLE);
        h.removeCallbacks(hideInfo);
        h.postDelayed(hideInfo, 4000);
    }

    private void loadLogo(ImageView iv, String url) {
        if (url == null || url.isEmpty()) {
            Glide.with(this).clear(iv);
            iv.setImageDrawable(null);
        } else {
            Glide.with(this).load(url).into(iv);
        }
    }

    private void showPanel() {
        info.setVisibility(View.GONE);
        panel.setVisibility(View.VISIBLE);
        String g = playingGroup != null ? playingGroup : G_ALL;
        if (!groupNames.contains(g)) g = groupNames.size() > 2 ? G_ALL : G_SETTINGS;
        selectGroup(g);
        int ci = playing != null ? indexOfUrl(shownList, playing.url) : 0;
        if (!shownList.isEmpty()) focusRow(channelsView, Math.max(0, ci));
        else focusRow(groupsView, groupNames.indexOf(g));
    }

    private void hidePanel() {
        panel.setVisibility(View.GONE);
    }

    private void selectGroup(String g) {
        shownGroup = g;
        shownList = listFor(g);
        channelAdapter.notifyDataSetChanged();
        groupAdapter.notifyDataSetChanged();
        if (G_SETTINGS.equals(g)) channelsTitle.setText("Apasă OK pentru setări");
        else channelsTitle.setText(g.trim() + "  (" + shownList.size() + ")");
    }

    private void focusRow(RecyclerView rv, int pos) {
        if (pos < 0) pos = 0;
        final int p = pos;
        ((LinearLayoutManager) rv.getLayoutManager()).scrollToPositionWithOffset(p, 200);
        rv.post(() -> {
            RecyclerView.ViewHolder vh = rv.findViewHolderForAdapterPosition(p);
            if (vh != null) vh.itemView.requestFocus();
            else rv.postDelayed(() -> {
                RecyclerView.ViewHolder v2 = rv.findViewHolderForAdapterPosition(p);
                if (v2 != null) v2.itemView.requestFocus(); else rv.requestFocus();
            }, 100);
        });
    }

    private void toggleFav(Channel c) {
        if (c == null) return;
        if (favs.contains(c.url)) { favs.remove(c.url); toast("Scos de la favorite: " + c.name); }
        else { favs.add(c.url); toast("Adăugat la favorite: " + c.name); }
        prefs.edit().putStringSet("favs", new HashSet<>(favs)).apply();
        channelAdapter.notifyDataSetChanged();
    }

    private void openSettings() {
        View v = getLayoutInflater().inflate(R.layout.dialog_settings, null);
        EditText urlField = v.findViewById(R.id.url);
        TextView hint = v.findViewById(R.id.phoneHint);
        String cur = prefs.getString("url", "");
        if (!cur.startsWith("local:")) urlField.setText(cur);
        String ip = PhoneServer.localIp();
        int port = server != null ? server.getPort() : -1;
        if (ip != null && port > 0) {
            hint.setText("Mai simplu, de pe telefon (aceeași rețea Wi-Fi):\ndeschide în browser adresa\n\n"
                    + "http://" + ip + ":" + port
                    + "\n\nși lipește acolo linkul sau alege fișierul .m3u.");
        } else {
            hint.setText("Televizorul nu pare conectat la rețea.");
        }
        settingsDialog = new AlertDialog.Builder(this, R.style.Dialog)
                .setTitle("Playlist M3U")
                .setView(v)
                .setPositiveButton("Salvează", (d, w) -> {
                    String u = urlField.getText().toString().trim();
                    if (!u.isEmpty()) {
                        prefs.edit().putString("url", u).apply();
                        refreshFromSource(true);
                    }
                })
                .setNeutralButton("Reîncarcă", (d, w) -> refreshFromSource(true))
                .setNegativeButton("Închide", null)
                .create();
        settingsDialog.show();
    }

    private void commitNumber() {
        String s = numBuf.toString();
        numBuf.setLength(0);
        numberEntry.setVisibility(View.GONE);
        if (s.isEmpty()) return;
        int n;
        try { n = Integer.parseInt(s); } catch (Exception e) { return; }
        if (n >= 1 && n <= all.size()) play(G_ALL, all, n - 1, true);
        else toast("Nu există canalul " + n);
    }

    private void exitOrConfirm() {
        long now = System.currentTimeMillis();
        if (now - lastBack < 2500) finish();
        else { lastBack = now; toast("Apasă încă o dată Înapoi pentru a ieși"); }
    }

    // ------------------------------------------------------------------ keys

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(e);
        int k = e.getKeyCode();

        if (panel.getVisibility() == View.VISIBLE) {
            if (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_ESCAPE) {
                if (playing != null && player != null) hidePanel();
                else exitOrConfirm();
                return true;
            }
            if (k == KeyEvent.KEYCODE_MENU || k == KeyEvent.KEYCODE_BOOKMARK) {
                View f = getCurrentFocus();
                if (f != null && f.getParent() == channelsView) {
                    int pos = channelsView.getChildAdapterPosition(f);
                    if (pos >= 0 && pos < shownList.size()) toggleFav(shownList.get(pos));
                }
                return true;
            }
            return super.dispatchKeyEvent(e);
        }

        // video is showing (panel hidden)
        if (k >= KeyEvent.KEYCODE_0 && k <= KeyEvent.KEYCODE_9
                || k >= KeyEvent.KEYCODE_NUMPAD_0 && k <= KeyEvent.KEYCODE_NUMPAD_9) {
            int d = k <= KeyEvent.KEYCODE_9 ? k - KeyEvent.KEYCODE_0 : k - KeyEvent.KEYCODE_NUMPAD_0;
            if (numBuf.length() < 5) numBuf.append(d);
            numberEntry.setText(numBuf);
            numberEntry.setVisibility(View.VISIBLE);
            h.removeCallbacks(commitNumber);
            h.postDelayed(commitNumber, 1800);
            return true;
        }
        switch (k) {
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_PAGE_UP:
                if (playingList != null) play(playingGroup, playingList, playingIndex + 1, true);
                else showPanel();
                return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_PAGE_DOWN:
                if (playingList != null) play(playingGroup, playingList, playingIndex - 1, true);
                else showPanel();
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                if (numBuf.length() > 0) { h.removeCallbacks(commitNumber); commitNumber(); }
                else showPanel();
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                showPanel();
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_INFO:
                showInfo();
                return true;
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_BOOKMARK:
                toggleFav(playing);
                showInfo();
                return true;
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                exitOrConfirm();
                return true;
        }
        return super.dispatchKeyEvent(e);
    }

    // ------------------------------------------------------------------ adapters

    private static class VH extends RecyclerView.ViewHolder {
        VH(View v) { super(v); }
    }

    private class GroupAdapter extends RecyclerView.Adapter<VH> {
        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int type) {
            return new VH(LayoutInflater.from(parent.getContext()).inflate(R.layout.item_group, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull VH vh, int position) {
            String g = groupNames.get(position);
            TextView tv = (TextView) vh.itemView;
            tv.setText(g);
            tv.setActivated(g.equals(shownGroup));
            tv.setOnFocusChangeListener((v, has) -> {
                if (!has) return;
                int p = vh.getBindingAdapterPosition();
                if (p < 0 || p >= groupNames.size()) return;
                String name = groupNames.get(p);
                if (name.equals(shownGroup)) return;
                if (pendingGroup != null) h.removeCallbacks(pendingGroup);
                pendingGroup = () -> selectGroup(name);
                h.postDelayed(pendingGroup, 150);
            });
            tv.setOnClickListener(v -> {
                int p = vh.getBindingAdapterPosition();
                if (p < 0) return;
                String name = groupNames.get(p);
                if (G_SETTINGS.equals(name)) { openSettings(); return; }
                if (!name.equals(shownGroup)) selectGroup(name);
                if (!shownList.isEmpty()) focusRow(channelsView, 0);
                else toast("Nu sunt canale aici");
            });
            tv.setOnKeyListener((v, keyCode, ev) -> {
                if (ev.getAction() == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                    int p = vh.getBindingAdapterPosition();
                    if (p >= 0 && !groupNames.get(p).equals(shownGroup)) {
                        if (pendingGroup != null) h.removeCallbacks(pendingGroup);
                        selectGroup(groupNames.get(p));
                    }
                    if (!shownList.isEmpty()) {
                        int ci = playing != null ? indexOfUrl(shownList, playing.url) : 0;
                        focusRow(channelsView, Math.max(0, ci));
                    }
                    return true;
                }
                return false;
            });
        }

        @Override public int getItemCount() { return groupNames.size(); }
    }

    private class ChannelAdapter extends RecyclerView.Adapter<VH> {
        @NonNull @Override
        public VH onCreateViewHolder(@NonNull ViewGroup parent, int type) {
            return new VH(LayoutInflater.from(parent.getContext()).inflate(R.layout.item_channel, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull VH vh, int position) {
            Channel c = shownList.get(position);
            View v = vh.itemView;
            ((TextView) v.findViewById(R.id.num)).setText(String.valueOf(c.number));
            ((TextView) v.findViewById(R.id.name)).setText(c.name);
            v.findViewById(R.id.star).setVisibility(favs.contains(c.url) ? View.VISIBLE : View.GONE);
            v.setActivated(playing != null && playing.url.equals(c.url));
            loadLogo(v.findViewById(R.id.logo), c.logo);
            v.setOnClickListener(x -> {
                int p = vh.getBindingAdapterPosition();
                if (p < 0 || p >= shownList.size()) return;
                play(shownGroup, shownList, p, true);
                hidePanel();
            });
            v.setOnLongClickListener(x -> {
                int p = vh.getBindingAdapterPosition();
                if (p >= 0 && p < shownList.size()) toggleFav(shownList.get(p));
                return true;
            });
            v.setOnKeyListener((x, keyCode, ev) -> {
                if (ev.getAction() == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                    focusRow(groupsView, groupNames.indexOf(shownGroup));
                    return true;
                }
                return false;
            });
        }

        @Override public int getItemCount() { return shownList.size(); }
    }
}
