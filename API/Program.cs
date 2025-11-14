using AudioViz.Models;
using AudioViz.Services;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

// Windows Service-friendly host
builder.Host.UseWindowsService();

// DI + API surface
builder.Services.AddSingleton<UdpVizService>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// CORS (wide-open for dev; in prod you’ll be same-origin)
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

// Forwarded headers (NGINX/IIS reverse-proxy safe)
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
});

// Swagger always on (handy for LAN devices)
app.UseSwagger();
app.UseSwaggerUI();

// CORS before endpoints
app.UseCors();

// Serve SPA from wwwroot (PWA build goes here)
app.UseDefaultFiles();   // picks up index.html
app.UseStaticFiles();    // serves /wwwroot assets

// ---- Minimal API surface -------------------------------------------

// Status
app.MapGet("/status", (UdpVizService s) => Results.Ok(new
{
    running = s.IsRunning,
    config = s.Current
}));

// List output (render) devices that can be captured via loopback
app.MapGet("/devices", (UdpVizService s) => Results.Ok(s.ListRenderDevices()));

// Configure (can be called while running)
app.MapPost("/config", (UdpVizService s, StreamConfig cfg) =>
{
    s.Configure(cfg);
    return Results.Ok(s.Current);
});

// Start/Stop
app.MapPost("/stream/start", (UdpVizService s) => { s.Start(); return Results.Ok(); });
app.MapPost("/stream/stop", (UdpVizService s) => { s.Stop(); return Results.Ok(); });

// 5s preview trigger
app.MapPost("/preview", (UdpVizService s) => { s.PeekPreview(); return Results.Ok(); });

// SPA fallback (unknown routes -> index.html)
app.MapFallbackToFile("/index.html");

app.Run();
