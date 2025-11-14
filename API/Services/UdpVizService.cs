using System.Net;
using System.Net.Sockets;
using AudioViz.Models;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NWaves.Transforms;

namespace AudioViz.Services;

/// <summary>
/// Captures loopback audio (WASAPI), computes log-spaced magnitude bins,
/// and unicasts UDP bytes [0..255] to ESP32 at ~40–60 FPS.
/// Also sends small control packets (pattern, flags, preview) on Port+1.
/// </summary>
public sealed class UdpVizService
{
    private readonly object _gate = new();

    // capture
    private WasapiLoopbackCapture? _cap;
    private WaveFormat? _fmt;

    // UDP
    private UdpClient? _udp;      // data (bins)
    private UdpClient? _udpCtrl;  // control

    private System.Threading.Timer? _timer;

    // audio / ring
    private int _fs = 48000;
    private float[] _ring = Array.Empty<float>();
    private int _ringWrite;
    private int _ringCount;

    // FFT/dsp
    private int _fftSize = 1024;
    private int _hopSize = 512;
    private float[] _win = Array.Empty<float>();
    private Fft? _fft;
    private float[] _re = Array.Empty<float>();
    private float[] _im = Array.Empty<float>();
    private float[] _mag = Array.Empty<float>(); // |rfft| 0..N/2

    // Config
    private string _espIp = "192.168.1.9";
    private int _port = 7777;
    private int _bins = 32;
    private float _gainDb = 12f;
    private string? _deviceId = null;
    private string _pattern = "bars";
    private bool _useStatusLed = true;

    public bool IsRunning { get; private set; }

    public StreamConfig Current =>
        new()
        {
            EspIp = _espIp,
            Port = _port,
            Bins = _bins,
            GainDb = _gainDb,
            FftSize = _fftSize,
            HopSize = _hopSize,
            DeviceId = _deviceId,
            Pattern = _pattern,
            UseStatusLed = _useStatusLed
        };

    private enum ControlCommand : byte
    {
        ApplyConfig = 1,
        PeekPreview = 2
    }

    // ---------- public API ----------

    public void Configure(StreamConfig cfg)
    {
        lock (_gate)
        {
            _espIp = cfg.EspIp;
            _port = cfg.Port;
            _bins = Math.Clamp(cfg.Bins, 4, 64);
            _gainDb = cfg.GainDb;
            _fftSize = NextPow2(Math.Clamp(cfg.FftSize, 256, 4096));
            _hopSize = Math.Clamp(cfg.HopSize, 128, _fftSize);
            _deviceId = cfg.DeviceId;
            _pattern = string.IsNullOrWhiteSpace(cfg.Pattern) ? "bars" : cfg.Pattern;
            _useStatusLed = cfg.UseStatusLed;

            if (IsRunning)
            {
                RebuildDsp_NoLock();
            }

            // Push new pattern/flags down to ESP regardless of running
            SendControl_NoLock(ControlCommand.ApplyConfig);
        }
    }

    public IEnumerable<object> ListRenderDevices()
    {
        var en = new MMDeviceEnumerator();
        return en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)
            .Select(d => new { id = d.ID, name = d.FriendlyName });
    }

    public void Start()
    {
        lock (_gate)
        {
            if (IsRunning) return;

            var enumerator = new MMDeviceEnumerator();
            MMDevice dev = _deviceId is null
                ? enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia)
                : enumerator.GetDevice(_deviceId);

            _cap = new WasapiLoopbackCapture(dev);
            _fmt = _cap.WaveFormat;
            _fs = _fmt.SampleRate;

            // ring buffer ~2 seconds
            _ring = new float[_fs * 2];
            _ringWrite = 0;
            _ringCount = 0;

            RebuildDsp_NoLock();

            _udp ??= new UdpClient();
            _udpCtrl ??= new UdpClient();

            _cap.DataAvailable += OnData;
            _cap.StartRecording();

            var fps = Math.Max(20, Math.Min(90, _fs / Math.Max(1, _hopSize)));
            _timer = new System.Threading.Timer(_ => Tick(), null, 50, 1000 / fps);

            IsRunning = true;

            SendControl_NoLock(ControlCommand.ApplyConfig);
        }
    }

    public void Stop()
    {
        lock (_gate)
        {
            if (!IsRunning) return;

            _timer?.Dispose();
            _timer = null;

            _cap?.StopRecording();
            _cap?.Dispose();
            _cap = null;

            _udp?.Dispose();
            _udp = null;

            _udpCtrl?.Dispose();
            _udpCtrl = null;

            _ring = Array.Empty<float>();
            _re = _im = _mag = _win = Array.Empty<float>();
            _fft = null;

            IsRunning = false;
        }
    }

    // Trigger a 5s preview on ESP
    public void PeekPreview()
    {
        lock (_gate)
        {
            SendControl_NoLock(ControlCommand.PeekPreview);
        }
    }

    // ---------- internals ----------

    private void SendControl_NoLock(ControlCommand cmd)
    {
        if (string.IsNullOrWhiteSpace(_espIp)) return;

        _udpCtrl ??= new UdpClient();

        byte patternId = _pattern switch
        {
            "mirror" => 1,
            "dots" => 2,
            "comet" => 3,
            _ => 0
        };

        byte flags = 0;
        if (_useStatusLed) flags |= 0x01;

        var payload = new byte[] { 0xA5, (byte)cmd, patternId, flags };

        try
        {
            _udpCtrl.Send(payload, payload.Length,
                new IPEndPoint(IPAddress.Parse(_espIp), _port + 1)); // Port+1 = control
        }
        catch
        {
            // ignore network errors
        }
    }

    private void RebuildDsp_NoLock()
    {
        _win = Hann(_fftSize);
        _fft = new Fft(_fftSize);
        _re = new float[_fftSize];
        _im = new float[_fftSize];
        _mag = new float[_fftSize / 2 + 1];
    }

    private void OnData(object? sender, WaveInEventArgs e)
    {
        if (_fmt is null) return;

        int bytesPerSample = _fmt.BitsPerSample / 8;
        int channels = _fmt.Channels;
        int frames = e.BytesRecorded / (bytesPerSample * channels);

        int idx = 0;
        for (int f = 0; f < frames; f++)
        {
            float mono = 0f;

            if (_fmt.Encoding == WaveFormatEncoding.IeeeFloat)
            {
                for (int c = 0; c < channels; c++)
                {
                    mono += BitConverter.ToSingle(e.Buffer, idx);
                    idx += 4;
                }
            }
            else
            {
                for (int c = 0; c < channels; c++)
                {
                    short s = BitConverter.ToInt16(e.Buffer, idx);
                    idx += 2;
                    mono += s / 32768f;
                }
            }

            mono /= channels;
            WriteRing(mono);
        }
    }

    private void WriteRing(float sample)
    {
        int pos = _ringWrite;
        if (_ring.Length == 0) return;

        _ring[pos] = sample;
        _ringWrite = (pos + 1) % _ring.Length;
        if (_ringCount < _ring.Length) _ringCount++;
    }

    private void Tick()
    {
        byte[]? payload = null;

        lock (_gate)
        {
            if (!IsRunning || _ringCount < _fftSize || _udp is null) return;

            var frame = new float[_fftSize];
            int start = (_ringWrite - _fftSize + _ring.Length) % _ring.Length;
            for (int i = 0; i < _fftSize; i++)
                frame[i] = _ring[(start + i) % _ring.Length] * _win[i];

            Array.Clear(_re, 0, _re.Length);
            Array.Clear(_im, 0, _im.Length);
            Array.Copy(frame, _re, _fftSize);
            _fft!.Direct(_re, _im);

            int half = _fftSize / 2;
            for (int k = 0; k <= half; k++)
                _mag[k] = MathF.Sqrt(_re[k] * _re[k] + _im[k] * _im[k]);

            payload = ToBins(_mag, _fs, _bins, _gainDb);
        }

        if (payload is not null)
        {
            try
            {
                _udp!.Send(payload, payload.Length,
                    new IPEndPoint(IPAddress.Parse(_espIp), _port));
            }
            catch
            {
                // ignore transient errors
            }
        }
    }

    private static byte[] ToBins(float[] mag, int fs, int bins, float gainDb)
    {
        int n = mag.Length - 1;
        float fMax = fs / 2f;

        float[] edges = new float[bins + 1];
        for (int i = 0; i <= bins; i++)
            edges[i] = 20f * MathF.Pow(fMax / 20f, i / (float)bins);

        float[] acc = new float[bins];
        for (int b = 0; b < bins; b++)
        {
            int i0 = Math.Clamp((int)(edges[b] * n / fMax), 0, n);
            int i1 = Math.Clamp((int)(edges[b + 1] * n / fMax), 0, n);
            float sum = 0f; int cnt = 0;
            for (int i = i0; i <= i1; i++) { sum += mag[i]; cnt++; }
            acc[b] = cnt > 0 ? sum / cnt : 0f;
        }

        float g = MathF.Pow(10f, gainDb / 20f);
        byte[] outb = new byte[bins];
        for (int i = 0; i < bins; i++)
        {
            float v = acc[i] * g;
            float db = 20f * MathF.Log10(v + 1e-6f);
            float norm = Math.Clamp((db + 60f) / 60f, 0f, 1f);
            outb[i] = (byte)(norm * 255f);
        }
        return outb;
    }

    private static int NextPow2(int x) { int p = 1; while (p < x) p <<= 1; return p; }

    private static float[] Hann(int n)
    {
        var w = new float[n];
        for (int i = 0; i < n; i++)
            w[i] = 0.5f - 0.5f * MathF.Cos(2 * MathF.PI * i / (n - 1));
        return w;
    }
}
