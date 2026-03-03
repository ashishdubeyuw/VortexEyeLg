# VortexEye: AI-Powered Seamless Indoor-Outdoor Navigation

## Project Proposal

---

## 1. Your Information

**Name:** Ashish Dubey  
**Email:** [your.email@university.edu]

---

## 2. Elevator Pitch

> **"A lot of visually impaired individuals and pedestrians in unfamiliar buildings struggle with navigating seamlessly from indoor spaces to outdoor destinations, which causes frustration, wasted time, and safety concerns. So I built VortexEye, an AI-powered mobile navigation app that helps them complete end-to-end journeys by combining computer vision for indoor guidance with GPS for outdoor routing. Unlike Google Maps (which stops at building entrances) or expensive indoor positioning systems, my solution requires no infrastructure installation and works on any smartphone camera."**

---

## 3. Project Description

### Problem Statement & Significance

Current navigation solutions have a critical gap: **GPS works outdoors, but fails indoors.** This creates a "last mile" problem where users:
- Get lost inside malls, airports, hospitals, and office buildings
- Cannot find exits, elevators, restrooms, or specific rooms
- Lose navigation continuity when transitioning between indoor and outdoor spaces

**Who is affected:**
- 285 million visually impaired people worldwide
- Elderly individuals with mobility challenges
- Any pedestrian in unfamiliar indoor environments

### How AI Technologies Address This Problem

| AI Technology | Application in VortexEye |
|---------------|-------------------------|
| **Computer Vision (OpenCV/TensorFlow.js)** | Detects doors, exit signs, elevators, stairs in real-time camera feed |
| **Object Detection (COCO-SSD/YOLO)** | Identifies indoor navigation landmarks and obstacles |
| **Speech Synthesis (Web Speech API)** | Provides audio turn-by-turn directions for hands-free navigation |
| **Geocoding AI (Nominatim + NLP)** | Understands natural language destinations ("nearest Starbucks") |
| **Path Prediction Algorithm** | Connects indoor camera-based positioning with outdoor GPS routing |

### Target Users

1. **Primary:** Visually impaired individuals who need audio-guided navigation
2. **Secondary:** General pedestrians navigating unfamiliar buildings (tourists, patients, visitors)
3. **Tertiary:** Accessibility-focused organizations and building managers

### Data Sources

- **OpenStreetMap (OSM)**: Free outdoor mapping and POI data
- **OSRM**: Open-source routing engine for walking/driving directions
- **Nominatim**: Geocoding service to convert addresses to coordinates
- **Camera Feed**: Real-time video for indoor object detection
- **Device Sensors**: GPS, accelerometer, gyroscope for positioning

### Anticipated Challenges

1. **Indoor Positioning Without Beacons**: Camera-based dead reckoning has drift over time
2. **Object Detection Accuracy**: Need robust detection in varied lighting conditions
3. **Seamless Handoff**: Smooth transition from indoor vision-based to outdoor GPS-based navigation
4. **Battery Consumption**: Real-time camera + GPS is power-intensive

**Questions for Instructor:**
- Recommendations for improving indoor positioning accuracy without infrastructure?
- Best practices for deploying TensorFlow.js models on low-end mobile devices?

---

## 4. Implementation Plan

### Type of Solution

**Progressive Web App (PWA)** - Works on any smartphone browser without app store installation

### AI Technologies Used

| Technology | Purpose |
|------------|---------|
| **TensorFlow.js + COCO-SSD** | Client-side object detection (doors, signs, obstacles) |
| **OpenCV.js** | Image processing and feature extraction |
| **Web Speech API** | Text-to-speech for audio navigation |
| **Nominatim AI** | Natural language geocoding |
| **OSRM Routing Engine** | Outdoor route calculation |

### Technical Approach & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER INPUT                                     │
│                    "Navigate to Fred Meyer"                             │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    VOICE INTERFACE (NLP)                                │
│              Parse intent → destination extraction                      │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│   INDOOR MODE       │         │   OUTDOOR MODE      │
│   (No GPS/Weak GPS) │         │   (Strong GPS)      │
└─────────┬───────────┘         └─────────┬───────────┘
          │                               │
          ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│ Camera + AI Vision  │         │ GPS + OSRM Routing  │
│ • Object Detection  │         │ • Turn-by-turn nav  │
│ • Door/Exit finding │         │ • ETA calculation   │
│ • Direction guiding │         │ • Rerouting         │
└─────────┬───────────┘         └─────────┬───────────┘
          │                               │
          └───────────┬───────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    PATH PREDICTION ENGINE                               │
│         Connect indoor detection → transition point → outdoor route     │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    SPEECH SYNTHESIS                                     │
│              "Turn left in 5 steps. Door ahead."                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Demo Concept for GenAI & Agentic Fair

**Live Demo Scenario:**
1. **Start indoors** (conference room or auditorium)
2. User speaks: *"Navigate to the nearest coffee shop"*
3. App detects user is indoors → activates **camera-based navigation**
4. Camera identifies **exit sign** → guides user with audio: *"Exit detected ahead, walk 8 steps"*
5. User exits building → **GPS activates** → seamless handoff to outdoor routing
6. Turn-by-turn audio guides user to destination

**What Attendees Will See:**
- Real-time object detection overlay on camera
- Map showing connected indoor-outdoor path
- Voice interaction and audio guidance
- QR code to try on their own phones

---

*VortexEye: Bridging the gap between indoor and outdoor navigation using AI.*
