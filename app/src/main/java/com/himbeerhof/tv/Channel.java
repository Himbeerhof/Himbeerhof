package com.himbeerhof.tv;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Channel {
    public String name = "";
    public String url = "";
    public String logo = "";
    public String group = "";
    public String userAgent = null;
    public String referrer = null;
    public int number;

    private static final Pattern ATTR = Pattern.compile("([a-zA-Z0-9_-]+)=\"([^\"]*)\"");

    /** Parses an M3U / M3U8 playlist (IPTV style with #EXTINF attributes). */
    public static List<Channel> parse(String text) {
        List<Channel> out = new ArrayList<>();
        if (text == null) return out;
        Channel cur = null;
        String pendingGroup = null;
        String[] lines = text.split("\\r?\\n|\\r");
        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty()) continue;
            if (line.startsWith("﻿")) line = line.substring(1);
            if (line.startsWith("#EXTINF")) {
                cur = new Channel();
                int comma = findNameComma(line);
                String attrs = comma >= 0 ? line.substring(0, comma) : line;
                cur.name = comma >= 0 ? line.substring(comma + 1).trim() : "";
                Matcher m = ATTR.matcher(attrs);
                String tvgName = null;
                while (m.find()) {
                    String k = m.group(1).toLowerCase();
                    String v = m.group(2).trim();
                    switch (k) {
                        case "tvg-logo": case "logo": cur.logo = v; break;
                        case "group-title": cur.group = v; break;
                        case "tvg-name": tvgName = v; break;
                        case "user-agent": case "http-user-agent": cur.userAgent = v; break;
                        case "referrer": case "http-referrer": cur.referrer = v; break;
                    }
                }
                if (cur.name.isEmpty() && tvgName != null) cur.name = tvgName;
            } else if (line.startsWith("#EXTGRP:")) {
                pendingGroup = line.substring(8).trim();
            } else if (line.startsWith("#EXTVLCOPT:")) {
                if (cur == null) cur = new Channel();
                String opt = line.substring(11).trim();
                int eq = opt.indexOf('=');
                if (eq > 0) {
                    String k = opt.substring(0, eq).trim().toLowerCase();
                    String v = opt.substring(eq + 1).trim();
                    if (k.equals("http-user-agent")) cur.userAgent = v;
                    else if (k.equals("http-referrer") || k.equals("http-referer")) cur.referrer = v;
                }
            } else if (line.startsWith("#")) {
                // other directives ignored
            } else {
                Channel c = cur != null ? cur : new Channel();
                String u = line;
                // Kodi style "url|User-Agent=...&Referer=..."
                int pipe = u.indexOf('|');
                if (pipe > 0) {
                    String opts = u.substring(pipe + 1);
                    u = u.substring(0, pipe);
                    for (String p : opts.split("&")) {
                        int eq = p.indexOf('=');
                        if (eq <= 0) continue;
                        String k = p.substring(0, eq).trim().toLowerCase();
                        String v = p.substring(eq + 1).trim();
                        if (k.equals("user-agent")) c.userAgent = v;
                        else if (k.equals("referer") || k.equals("referrer")) c.referrer = v;
                    }
                }
                c.url = u;
                if (c.group.isEmpty() && pendingGroup != null) c.group = pendingGroup;
                if (c.group.isEmpty()) c.group = "Altele";
                if (c.name.isEmpty()) c.name = u;
                c.number = out.size() + 1;
                out.add(c);
                cur = null;
                pendingGroup = null;
            }
        }
        return out;
    }

    /** The display name follows the last comma that is outside of quoted attributes. */
    private static int findNameComma(String line) {
        boolean inQuote = false;
        for (int i = 0; i < line.length(); i++) {
            char ch = line.charAt(i);
            if (ch == '"') inQuote = !inQuote;
            else if (ch == ',' && !inQuote) {
                // the first comma after the duration/attributes section
                return i;
            }
        }
        return line.lastIndexOf(',');
    }

    public static Map<String, List<Channel>> byGroup(List<Channel> all) {
        Map<String, List<Channel>> map = new LinkedHashMap<>();
        for (Channel c : all) {
            List<Channel> l = map.get(c.group);
            if (l == null) { l = new ArrayList<>(); map.put(c.group, l); }
            l.add(c);
        }
        return map;
    }
}
