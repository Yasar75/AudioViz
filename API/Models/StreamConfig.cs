namespace AudioViz.Models;

public class StreamConfig
{
    // ESP32 target
    public string EspIp { get; set; } = "192.168.1.9";
    public int Port { get; set; } = 7777;

    // DSP/output
    public int Bins { get; set; } = 32;           // 16 / 32 / 64
    public float GainDb { get; set; } = 12f;
    public int FftSize { get; set; } = 1024;
    public int HopSize { get; set; } = 512;

    // Audio capture
    public string? DeviceId { get; set; } = null; // null = default render

    // Visual control → ESP32
    public string Pattern { get; set; } = "bars"; // bars | mirror | dots | comet
    public bool UseStatusLed { get; set; } = true;
}
