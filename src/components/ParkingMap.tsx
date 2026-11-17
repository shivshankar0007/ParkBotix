"use client";

import React, { useEffect, useRef } from "react";
import type * as LeafletTypes from "leaflet";

export interface MapLot {
  id: number;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  availableSlots: number;
  totalSlotCount: number;
  baseHourlyRate: number;
  evAvailable: number;
  distanceKm: number | null;
}

interface ParkingMapProps {
  lots: MapLot[];
  selectedLotId: number | null;
  userCoords: { lat: number; lng: number } | null;
  onSelectLot: (lotId: number) => void;
}

export function ParkingMap({
  lots,
  selectedLotId,
  userCoords,
  onSelectLot,
}: ParkingMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletTypes.Map | null>(null);
  const markersLayerRef = useRef<LeafletTypes.LayerGroup | null>(null);
  const leafletRef = useRef<typeof LeafletTypes | null>(null);

  useEffect(() => {
    let active = true;

    async function initMap() {
      if (!containerRef.current || mapRef.current) return;
      const L = await import("leaflet");
      if (!active || !containerRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: [12.955, 77.625],
        zoom: 12,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      markersLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
    }

    void initMap();

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!L || !map || !layer) return;

    layer.clearLayers();

    if (userCoords) {
      const userIcon = L.divIcon({
        className: "custom-user-pin",
        html: `<div style="width:18px;height:18px;border-radius:9999px;background:#0EA5E9;border:3px solid #FFFFFF;box-shadow:0 0 0 6px rgba(14,165,233,0.28);"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      L.marker([userCoords.lat, userCoords.lng], { icon: userIcon })
        .bindPopup("<strong>Your Location</strong>")
        .addTo(layer);
    }

    for (const lot of lots) {
      const isSelected = lot.id === selectedLotId;
      const color =
        lot.availableSlots === 0
          ? "#EF4444"
          : lot.availableSlots <= 3
          ? "#F59E0B"
          : "#10B981";

      const badgeHtml = `
        <div style="
          display:flex;align-items:center;gap:6px;
          padding:5px 10px;border-radius:9999px;
          background:${isSelected ? "#4F46E5" : "#0F172A"};
          color:#FFFFFF;font-weight:700;font-size:12px;
          border:2px solid ${isSelected ? "#A5B4FC" : color};
          box-shadow:0 8px 18px rgba(15,23,42,0.32);
          white-space:nowrap;cursor:pointer;
        ">
          <span style="width:8px;height:8px;border-radius:9999px;background:${color};display:inline-block;"></span>
          <span>₹${lot.baseHourlyRate}</span>
          <span style="opacity:0.8;font-family:monospace;">${lot.availableSlots} open</span>
        </div>
      `;

      const icon = L.divIcon({
        className: "parkbotix-lot-pin",
        html: badgeHtml,
        iconSize: [110, 30],
        iconAnchor: [55, 15],
      });

      const marker = L.marker([lot.latitude, lot.longitude], { icon }).addTo(layer);
      marker.on("click", () => onSelectLot(lot.id));
      marker.bindTooltip(
        `<div style="font-size:12px;"><strong>${lot.name}</strong><br/>${lot.availableSlots}/${lot.totalSlotCount} bays open • ${lot.evAvailable} EV</div>`,
        { direction: "top", offset: [0, -14] }
      );
    }

    const selected = lots.find((l) => l.id === selectedLotId);
    if (selected) {
      map.flyTo([selected.latitude, selected.longitude], 14, { duration: 0.6 });
    } else if (userCoords) {
      map.flyTo([userCoords.lat, userCoords.lng], 12, { duration: 0.6 });
    }
  }, [lots, selectedLotId, userCoords, onSelectLot]);

  return (
    <div className="relative h-[360px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm lg:h-[420px]">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute bottom-3 left-3 z-[400] flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Open
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Filling Fast
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Full
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Your GPS
        </span>
      </div>
    </div>
  );
}
