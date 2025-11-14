import React, { useEffect, useMemo, useState } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Container,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Tabs,
  Tab,
  Box,
  Slider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  TextField,
  CssBaseline,
} from "@mui/material";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import { ThemeProvider, createTheme } from "@mui/material/styles";

import {
  getStatus,
  getDevices,
  setConfig,
  startStream,
  stopStream,
  peekPreview,
} from "./api";
import "./App.css";

const DEFAULT_CFG = {
  espIp: "192.168.1.9",
  port: 7777,
  bins: 32,
  gainDb: 12,
  fftSize: 1024,
  hopSize: 512,
  deviceId: null,
  pattern: "bars",
  useStatusLed: true,
};

// Visual presets for the whole app (background, cards, accents)
const THEME_PRESETS = {
  aurora: {
    label: "Aurora",
    primary: "#22d3ee",
    accent: "#a855f7",
    bgColor: "#020617",
    cardColor: "#020617",
    textPrimary: "#e5e7eb",
    textSecondary: "#9ca3af",
    bgGradient:
      "radial-gradient(circle at top left, #0f172a 0, #020617 45%, #000000 100%)",
  },
  fire: {
    label: "Firestorm",
    primary: "#f97316",
    accent: "#ef4444",
    bgColor: "#111827",
    cardColor: "#030712",
    textPrimary: "#f9fafb",
    textSecondary: "#9ca3af",
    bgGradient:
      "radial-gradient(circle at top, #7f1d1d 0, #111827 40%, #020617 100%)",
  },
  ocean: {
    label: "Ocean",
    primary: "#0ea5e9",
    accent: "#22c55e",
    bgColor: "#020617",
    cardColor: "#0b1120",
    textPrimary: "#e5e7eb",
    textSecondary: "#9ca3af",
    bgGradient:
      "linear-gradient(135deg, #0b1120 0, #020617 40%, #022c22 100%)",
  },
  mono: {
    label: "Mono Bars",
    primary: "#6366f1",
    accent: "#facc15",
    bgColor: "#020617",
    cardColor: "#020617",
    textPrimary: "#e5e7eb",
    textSecondary: "#9ca3af",
    bgGradient:
      "radial-gradient(circle at center, #111827 0, #020617 50%, #000000 100%)",
  },
};

function TabPanel({ value, index, children }) {
  if (value !== index) return null;
  return <Box sx={{ mt: 2 }}>{children}</Box>;
}

// Small UI-only visualizer to show the active pattern in the UI
function LedPreviewStrip({ count, pattern, theme, active }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) return;

    let raf;
    const tick = () => {
      setPhase((p) => (p + 0.06) % (Math.PI * 2));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [active, pattern]);

  const leds = [];
  const n = Math.max(4, count || 44);

  for (let i = 0; i < n; i++) {
    const x = n > 1 ? i / (n - 1) : 0;
    let lvl = 0.3;

    switch (pattern) {
      case "mirror": {
        const m = Math.min(x, 1 - x);
        lvl = 0.2 + 0.8 * Math.pow(Math.sin(phase + m * 6) * 0.5 + 0.5, 2);
        break;
      }
      case "dots": {
        lvl = 0.1 + 0.9 * Math.max(0, Math.sin(phase * 2 + x * 10));
        break;
      }
      case "comet": {
        const head = phase / (Math.PI * 2);
        const dist = Math.abs(x - head);
        lvl = Math.exp(-dist * 8);
        break;
      }
      default: {
        // bars
        lvl = 0.2 + 0.8 * Math.abs(Math.sin(phase + x * 8));
        break;
      }
    }

    leds.push(
      <Box
        key={i}
        sx={{
          flex: 1,
          mx: 0.2,
          borderRadius: 999,
          height: `${10 + 18 * lvl}px`,
          bgcolor: theme?.primary || "#22d3ee",
          opacity: 0.15 + 0.85 * lvl,
        }}
      />
    );
  }

  return (
    <Box
      sx={{
        mt: 2,
        p: 1,
        borderRadius: 2,
        bgcolor: "rgba(15,23,42,0.9)",
        display: "flex",
        alignItems: "flex-end",
        overflow: "hidden",
      }}
    >
      {leds}
    </Box>
  );
}

function App() {
  const [dark, setDark] = useState(true);
  const [themeKey, setThemeKey] = useState("aurora");

  const [cfg, setCfg] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("audioviz_cfg")) || DEFAULT_CFG;
    } catch {
      return DEFAULT_CFG;
    }
  });

  const [status, setStatus] = useState({ running: false, config: DEFAULT_CFG });
  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(0);

  const [layoutLedCount, setLayoutLedCount] = useState(44);
  const [peeking, setPeeking] = useState(false);

  // Initial sync from backend
  useEffect(() => {
    (async () => {
      try {
        const s = await getStatus();
        setStatus(s);
        setCfg((prev) => ({ ...prev, ...s.config }));
      } catch {
        // API unreachable, keep local state
      }
      try {
        const d = await getDevices();
        setDevices(d);
      } catch {
        // ignore
      }
    })();
  }, []);

  const preset = THEME_PRESETS[themeKey] ?? THEME_PRESETS.aurora;

  const theme = useMemo(() => {
    return createTheme({
      palette: {
        mode: dark ? "dark" : "light",
        primary: { main: preset.primary },
        secondary: { main: preset.accent },
        background: {
          default: preset.bgColor,
          paper: preset.cardColor,
        },
        text: {
          primary: preset.textPrimary,
          secondary: preset.textSecondary,
        },
      },
      shape: { borderRadius: 16 },
    });
  }, [dark, preset]);

  const running = !!status.running;

  const updateCfg = (k, v) => {
    const next = { ...cfg, [k]: v };
    setCfg(next);
  };

  const applyConfig = async () => {
    setBusy(true);
    try {
      const applied = await setConfig(cfg);
      setStatus((s) => ({ ...s, config: applied }));
      localStorage.setItem("audioviz_cfg", JSON.stringify(applied));
    } finally {
      setBusy(false);
    }
  };

  const handleStart = async () => {
    setBusy(true);
    try {
      await startStream();
      const s = await getStatus();
      setStatus(s);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await stopStream();
      const s = await getStatus();
      setStatus(s);
    } finally {
      setBusy(false);
    }
  };

  const handlePeek = async () => {
    setPeeking(true);
    try {
      await peekPreview();
    } catch {
      // ignore
    } finally {
      setTimeout(() => setPeeking(false), 5000);
    }
  };

  const sensitivityMarks = [
    { value: -6, label: "Low" },
    { value: 12, label: "Mid" },
    { value: 24, label: "High" },
  ];

  const statusColor = running ? "success" : "default";
  const statusLabel = running ? "Streaming" : "Idle";

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: "100vh",
          bgcolor: preset.bgColor,
          backgroundImage: preset.bgGradient,
          backgroundSize: "cover",
          backgroundAttachment: "fixed",
          color: theme.palette.text.primary,
          pb: 4,
        }}
      >
        <AppBar
          position="static"
          elevation={0}
          sx={{
            bgcolor: "transparent",
            boxShadow: "none",
            backdropFilter: "blur(18px)",
          }}
        >
          <Toolbar
            sx={{ justifyContent: "space-between", alignItems: "center" }}
          >
            {/* Brand + version + author */}
            <Box sx={{ display: "flex", flexDirection: "column" }}>
              <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  AudioViz
                </Typography>
                <Typography
                  component="span"
                  variant="subtitle2"
                  sx={{ color: "text.secondary" }}
                >
                  v1.0
                </Typography>
              </Box>
              <Typography
                component="span"
                variant="caption"
                sx={{ color: "text.secondary" }}
              >
                by Yasar
              </Typography>
            </Box>

            {/* Status + theme toggle */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Chip label={statusLabel} color={statusColor} />
              <IconButton onClick={() => setDark((d) => !d)} size="large">
                {dark ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Box>
          </Toolbar>
        </AppBar>

        <Container maxWidth="lg" sx={{ py: 3 }}>
          <Grid container spacing={3}>
            {/* LEFT: Quick controls + Status */}
            <Grid item xs={12} md={5}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Quick Controls
                  </Typography>

                  {/* ESP + network */}
                  <Box sx={{ mt: 1, display: "flex", gap: 2 }}>
                    <TextField
                      label="ESP32 IP"
                      size="small"
                      fullWidth
                      value={cfg.espIp}
                      onChange={(e) => updateCfg("espIp", e.target.value)}
                    />
                    <TextField
                      label="UDP Port"
                      size="small"
                      type="number"
                      sx={{ width: 130 }}
                      value={cfg.port}
                      onChange={(e) =>
                        updateCfg("port", Number(e.target.value || 0))
                      }
                    />
                  </Box>

                  {/* Device picker */}
                  <Box sx={{ mt: 3 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Output device</InputLabel>
                      <Select
                        label="Output device"
                        value={cfg.deviceId || ""}
                        onChange={(e) =>
                          updateCfg("deviceId", e.target.value || null)
                        }
                      >
                        <MenuItem value="">(Default output device)</MenuItem>
                        {devices.map((d) => (
                          <MenuItem key={d.id} value={d.id}>
                            {d.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>

                  {/* DSP sliders */}
                  <Box sx={{ mt: 3 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      DSP
                    </Typography>

                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Sensitivity (Gain dB)
                    </Typography>
                    <Slider
                      value={cfg.gainDb}
                      min={-6}
                      max={24}
                      step={1}
                      marks={sensitivityMarks}
                      onChange={(_, v) => updateCfg("gainDb", v)}
                    />

                    <Typography variant="body2" sx={{ mt: 2 }}>
                      Smoothness (Hop Size)
                    </Typography>
                    <Slider
                      value={cfg.hopSize}
                      min={256}
                      max={1024}
                      step={256}
                      marks={[
                        { value: 256, label: "Fast" },
                        { value: 512, label: "Balanced" },
                        { value: 1024, label: "Soft" },
                      ]}
                      onChange={(_, v) => updateCfg("hopSize", v)}
                    />
                  </Box>
                </CardContent>
                <CardActions
                  sx={{ px: 2, pb: 2, justifyContent: "space-between" }}
                >
                  <Box sx={{ display: "flex", gap: 1 }}>
                    {running ? (
                      <Button
                        variant="contained"
                        color="warning"
                        onClick={handleStop}
                        disabled={busy}
                      >
                        Stop
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={handleStart}
                        disabled={busy}
                      >
                        Start
                      </Button>
                    )}
                    <Button
                      variant="outlined"
                      onClick={applyConfig}
                      disabled={busy}
                    >
                      Apply
                    </Button>
                  </Box>
                </CardActions>
              </Card>

              {/* Status JSON */}
              <Card sx={{ mt: 3 }}>
                <CardContent>
                  <Typography variant="subtitle1" gutterBottom>
                    Status
                  </Typography>
                  <pre
                    style={{
                      margin: 0,
                      background: "rgba(15,23,42,0.95)",
                      color: "#e2e8f0",
                      padding: 12,
                      borderRadius: 8,
                      fontSize: 12,
                      maxHeight: 230,
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(status, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </Grid>

            {/* RIGHT: Design / Layout / Advanced */}
            <Grid item xs={12} md={7}>
              <Card>
                <CardContent>
                  <Tabs
                    value={tab}
                    onChange={(_, v) => setTab(v)}
                    variant="scrollable"
                  >
                    <Tab label="DESIGN" />
                    <Tab label="LAYOUT" />
                    <Tab label="ADVANCED" />
                  </Tabs>

                  {/* DESIGN TAB */}
                  <TabPanel value={tab} index={0}>
                    <Typography variant="subtitle1" gutterBottom>
                      Theme
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                      {Object.entries(THEME_PRESETS).map(([key, t]) => (
                        <Button
                          key={key}
                          size="small"
                          variant={
                            themeKey === key ? "contained" : "outlined"
                          }
                          onClick={() => setThemeKey(key)}
                        >
                          {t.label}
                        </Button>
                      ))}
                    </Box>

                    <Box sx={{ mt: 3 }}>
                      <Typography variant="subtitle1" gutterBottom>
                        Wave pattern
                      </Typography>
                      <FormControl fullWidth size="small">
                        <InputLabel>Pattern</InputLabel>
                        <Select
                          label="Pattern"
                          value={cfg.pattern}
                          onChange={(e) =>
                            updateCfg("pattern", e.target.value)
                          }
                        >
                          <MenuItem value="bars">Energy bars</MenuItem>
                          <MenuItem value="mirror">Mirror bars</MenuItem>
                          <MenuItem value="dots">Dot wave</MenuItem>
                          <MenuItem value="comet">Comet trail</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>

                    {/* UI preview + LED preview mode */}
                    <LedPreviewStrip
                      count={layoutLedCount}
                      pattern={cfg.pattern}
                      theme={preset}
                      active={running || peeking}
                    />

                    <Box sx={{ mt: 2 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handlePeek}
                        disabled={busy}
                      >
                        PEEK PREVIEW (5s)
                      </Button>
                    </Box>
                  </TabPanel>

                  {/* LAYOUT TAB */}
                  <TabPanel value={tab} index={1}>
                    <Typography variant="subtitle1" gutterBottom>
                      LED Layout
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      LED count: {layoutLedCount}
                    </Typography>
                    <Slider
                      value={layoutLedCount}
                      min={10}
                      max={300}
                      step={1}
                      onChange={(_, v) => setLayoutLedCount(v)}
                    />

                    <Box sx={{ mt: 2 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Direction</InputLabel>
                        <Select label="Direction" defaultValue="ltr">
                          <MenuItem value="ltr">Left → Right</MenuItem>
                          <MenuItem value="rtl">Right → Left</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>

                    <FormControlLabel
                      sx={{ mt: 2 }}
                      control={
                        <Switch
                          checked={cfg.useStatusLed}
                          onChange={(e) =>
                            updateCfg("useStatusLed", e.target.checked)
                          }
                        />
                      }
                      label="Use LED0 as status indicator"
                    />
                  </TabPanel>

                  {/* ADVANCED TAB */}
                  <TabPanel value={tab} index={2}>
                    <Typography variant="subtitle1" gutterBottom>
                      Signal processing
                    </Typography>

                    <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                      <InputLabel>FFT Size</InputLabel>
                      <Select
                        label="FFT Size"
                        value={cfg.fftSize}
                        onChange={(e) =>
                          updateCfg("fftSize", Number(e.target.value))
                        }
                      >
                        <MenuItem value={512}>512</MenuItem>
                        <MenuItem value={1024}>1024</MenuItem>
                        <MenuItem value={2048}>2048</MenuItem>
                      </Select>
                    </FormControl>

                    <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                      <InputLabel>Bins</InputLabel>
                      <Select
                        label="Bins"
                        value={cfg.bins}
                        onChange={(e) =>
                          updateCfg("bins", Number(e.target.value))
                        }
                      >
                        <MenuItem value={16}>16</MenuItem>
                        <MenuItem value={32}>32</MenuItem>
                        <MenuItem value={64}>64</MenuItem>
                      </Select>
                    </FormControl>
                  </TabPanel>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default App;
