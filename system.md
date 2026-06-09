# System Architecture: Discord-to-Bybit "Watchlist & Sniper" Bot

## 1. Architectural Overview
This document outlines the event-driven architecture for a cryptocurrency trading bridge connecting Discord signal alerts to the Bybit V5 API. 

To solve the "Temporal Disconnect"—where the volatility (ATR) at the time of an "Approaching" alert differs from the volatility at the actual time of structural impact—this system utilizes a **Watchlist & Sniper** execution model. Orders are not placed immediately upon receiving a signal. Instead, setups are cached in memory, and execution is delegated to a real-time WebSocket listener that calculates dynamic risk parameters only at the microsecond the Order Block (OB) is breached.

---

## 2. Process Flow Diagram

```mermaid
graph TD
    %% Styling
    classDef discord fill:#5865F2,stroke:#fff,stroke-width:2px,color:#fff
    classDef nodejs fill:#339933,stroke:#fff,stroke-width:2px,color:#fff
    classDef bybit fill:#F7A600,stroke:#fff,stroke-width:2px,color:#000
    classDef logic fill:#2E3440,stroke:#88C0D0,stroke-width:2px,color:#fff
    
    %% Nodes
    A([Discord Alert: Approaching OB]):::discord
    B[Regex Parser: Extract Params]:::nodejs
    C[(In-Memory Watchlist Map)]:::nodejs

    D((Bybit WSS: Live Tick Data)):::bybit
    E{Live Price hits Proximal Edge?}:::logic

    F[Fetch Live Klines via REST]:::bybit
    G[Calculate Live 14-Period ATR]:::logic
    H[Apply Buffer and Calculate 1:3 RR]:::logic

    I([Execute Market Order w/ TPSL]):::bybit
    J[Remove Setup from Watchlist]:::nodejs

    %% Connections
    A -->|Webhook / Message| B
    B -->|Symbol, Proximal, Distal, Direction| C
    C -.->|Active Subscriptions| D
    D --> E
    E -->|No| D
    E -->|Yes| F
    F -->|Return Klines| G
    G --> H
    H -->|Entry, SL, TP| I
    I --> J
