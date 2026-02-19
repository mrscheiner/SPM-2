
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  TextInput,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Upload, FileSpreadsheet, Check, AlertTriangle } from 'lucide-react-native';
import { AppColors } from '@/constants/appColors';
import { useSeasonPass } from '@/providers/SeasonPassProvider';
import { Picker } from '@react-native-picker/picker';

type TicketRow = {
  totalPrice: number;
  eventName: string;
  eventStartTime: string;
  tickets: { section: string; row: string; seat_number: number }[];
};

type ImportResult = {
  success: boolean;
  salesCount: number;
  seatPairsCount: number;
  message?: string;
};

interface FileImportBoxProps {
  onImport: (rows: TicketRow[]) => Promise<ImportResult>;
  activePassId: string | null;
}

type ImportStatus = 'idle' | 'parsing' | 'importing' | 'success' | 'error';

function isZipLikeContent(text: string): boolean {
  const head = text.slice(0, 20);
  if (head.startsWith('PK') || head.startsWith('UEsDB')) return true;
  return /PK\x03\x04/.test(head);
}




// Improved CSV parser for exported SeasonPassData
function parseCSVContent(text: string): TicketRow[] {
  // Remove BOM and normalize line endings
  const cleanText = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = cleanText.split('\n').filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];
  // Find header row (skip empty lines)
  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === '') headerIdx++;
  // Use a CSV splitting regex to handle quoted commas
  function splitCSVRow(row: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result.map(s => s.replace(/^"|"$/g, '').trim());
  }
  const header = splitCSVRow(lines[headerIdx]);
  // Find column indices by exact match for exported file
  const idx = {
    eventName: header.findIndex(h => h === 'Opponent'),
    eventStartTime: header.findIndex(h => h === 'GameDate'),
    section: header.findIndex(h => h === 'Section'),
    row: header.findIndex(h => h === 'Row'),
    seats: header.findIndex(h => h === 'Seats'),
    seatCount: header.findIndex(h => h === 'SeatCount'),
    totalPrice: header.findIndex(h => h === 'SalePrice'),
    paymentStatus: header.findIndex(h => h === 'PaymentStatus'),
  };
  const rows: TicketRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.startsWith('#')) continue;
    const cols = splitCSVRow(line);
    // Skip summary/footer rows (e.g., TOTAL)
    if (cols[0] && cols[0].toLowerCase().includes('total')) continue;
    // Defensive: skip if not enough columns or missing required fields
    if (cols.length < 8 || !cols[idx.section] || !cols[idx.row] || !cols[idx.seats] || !cols[idx.totalPrice]) continue;
    // Parse seat numbers (e.g., "24-25" or "1-2")
    let seatNumbers: number[] = [];
    if (idx.seats >= 0 && cols[idx.seats]) {
      const seatStr = cols[idx.seats].replace(/\s/g, '');
      if (/\d+-\d+/.test(seatStr)) {
        const [start, end] = seatStr.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          for (let s = start; s <= end; s++) seatNumbers.push(s);
        }
      } else if (/\d+(,\d+)*/.test(seatStr)) {
        seatNumbers = seatStr.split(',').map(Number).filter(n => !isNaN(n));
      }
    }
    if (seatNumbers.length === 0 && idx.seatCount >= 0 && cols[idx.seatCount]) {
      // Fallback: just use seatCount
      const count = parseInt(cols[idx.seatCount], 10);
      if (!isNaN(count)) {
        seatNumbers = Array.from({ length: count }, (_, k) => k + 1);
      }
    }
    // Defensive: skip if price is not a number
    const price = parseFloat(cols[idx.totalPrice]);
    if (isNaN(price)) continue;
    rows.push({
      eventName: idx.eventName >= 0 ? cols[idx.eventName] : '',
      eventStartTime: idx.eventStartTime >= 0 ? cols[idx.eventStartTime] : '',
      totalPrice: price,
      tickets: seatNumbers.map(seat_number => ({
        section: idx.section >= 0 ? cols[idx.section] : '',
        row: idx.row >= 0 ? cols[idx.row] : '',
        seat_number,
      })),
    });
  }
  return rows;
}


function parseJSONContent(text: string): TicketRow[] {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) {
      // Try to coerce to TicketRow[]
      return data.map((row: any) => ({
        eventName: row.eventName || row.teamName || '',
        eventStartTime: row.eventStartTime || row.date || '',
        totalPrice: typeof row.totalPrice === 'number' ? row.totalPrice : parseFloat(row.totalPrice || '0'),
        tickets: Array.isArray(row.tickets)
          ? row.tickets.map((t: any) => ({
              section: t.section || '',
              row: t.row || '',
              seat_number: typeof t.seat_number === 'number' ? t.seat_number : parseInt(t.seat_number || '1', 10),
            }))
          : [],
      })).filter(r => r.tickets.length > 0);
    }
    return [];
  } catch {
    return [];
  }
}
// ...existing code...

const AUTO_IMPORT_CSV = `Team,Season,GameID,PairID,Section,Row,Seats,SeatCount,Price,PaymentStatus,,
Florida Panthers,2025-2026,1,pair1,129,26,24-25,2,234.0,Paid,,
Florida Panthers,2025-2026,1,pair2,308,8,1-2,2,124.2,Paid,,
Florida Panthers,2025-2026,1,pair3,325,5,6-7,2,138.6,Paid,,
Florida Panthers,2025-2026,2,pair1,129,26,24-25,2,59.17,Paid,,
Florida Panthers,2025-2026,2,pair2,308,8,1-2,2,23.4,Paid,,
Florida Panthers,2025-2026,2,pair3,325,5,6-7,2,27.2,Paid,,
Florida Panthers,2025-2026,3,pair1,129,26,24-25,2,128.0,Paid,,
Florida Panthers,2025-2026,3,pair2,308,8,1-2,2,45.76,Paid,,
Florida Panthers,2025-2026,3,pair3,325,5,6-7,2,54.0,Paid,,
Florida Panthers,2025-2026,4,pair1,129,26,24-25,2,103.57,Paid,,
Florida Panthers,2025-2026,4,pair2,308,8,1-2,2,36.5,Paid,,
Florida Panthers,2025-2026,4,pair3,325,5,6-7,2,41.54,Paid,,
Florida Panthers,2025-2026,5,pair1,129,26,24-25,2,153.0,Paid,,
Florida Panthers,2025-2026,5,pair2,308,8,1-2,2,52.2,Paid,,
Florida Panthers,2025-2026,5,pair3,325,5,6-7,2,72.0,Paid,,
Florida Panthers,2025-2026,6,pair1,129,26,24-25,2,37.8,Paid,,
Florida Panthers,2025-2026,6,pair2,308,8,1-2,2,27.0,Paid,,
Florida Panthers,2025-2026,6,pair3,325,5,6-7,2,39.22,Paid,,
Florida Panthers,2025-2026,7,pair1,129,26,24-25,2,118.8,Paid,,
Florida Panthers,2025-2026,7,pair2,308,8,1-2,2,36.0,Paid,,
Florida Panthers,2025-2026,7,pair3,325,5,6-7,2,54.0,Paid,,
Florida Panthers,2025-2026,8,pair1,129,26,24-25,2,83.65,Paid,,
Florida Panthers,2025-2026,8,pair2,308,8,1-2,2,25.83,Paid,,
Florida Panthers,2025-2026,8,pair3,325,5,6-7,2,30.6,Paid,,
Florida Panthers,2025-2026,9,pair1,129,26,24-25,2,197.66,Paid,,
Florida Panthers,2025-2026,9,pair2,308,8,1-2,2,107.32,Paid,,
Florida Panthers,2025-2026,9,pair3,325,5,6-7,2,71.01,Paid,,
Florida Panthers,2025-2026,10,pair1,129,26,24-25,2,59.4,Paid,,
Florida Panthers,2025-2026,10,pair2,308,8,1-2,2,19.96,Paid,,
Florida Panthers,2025-2026,10,pair3,325,5,6-7,2,21.87,Paid,,
Florida Panthers,2025-2026,11,pair1,129,26,24-25,2,48.94,Paid,,
Florida Panthers,2025-2026,11,pair2,308,8,1-2,2,26.69,Paid,,
Florida Panthers,2025-2026,11,pair3,325,5,6-7,2,13.5,Paid,,
Florida Panthers,2025-2026,12,pair1,129,26,24-25,2,162.0,Paid,,
Florida Panthers,2025-2026,12,pair2,308,8,1-2,2,74.61,Paid,,
Florida Panthers,2025-2026,12,pair3,325,5,6-7,2,108.27,Paid,,
Florida Panthers,2025-2026,13,pair1,129,26,24-25,2,113.58,Paid,,
Florida Panthers,2025-2026,13,pair2,308,8,1-2,2,35.28,Paid,,
Florida Panthers,2025-2026,13,pair3,325,5,6-7,2,37.98,Paid,,
Florida Panthers,2025-2026,14,pair1,129,26,24-25,2,138.6,Paid,,
Florida Panthers,2025-2026,14,pair2,308,8,1-2,2,48.6,Paid,,
Florida Panthers,2025-2026,14,pair3,325,5,6-7,2,47.77,Paid,,
Florida Panthers,2025-2026,15,pair1,129,26,24-25,2,127.35,Paid,,
Florida Panthers,2025-2026,15,pair2,308,8,1-2,2,54.0,Paid,,
Florida Panthers,2025-2026,15,pair3,325,5,6-7,2,41.4,Paid,,
Florida Panthers,2025-2026,16,pair1,129,26,24-25,2,55.8,Paid,,
Florida Panthers,2025-2026,16,pair2,308,8,1-2,2,32.13,Paid,,
Florida Panthers,2025-2026,16,pair3,325,5,6-7,2,29.99,Paid,,
Florida Panthers,2025-2026,17,pair1,129,26,24-25,2,72.09,Paid,,
Florida Panthers,2025-2026,17,pair2,308,8,1-2,2,16.18,Paid,,
Florida Panthers,2025-2026,17,pair3,325,5,6-7,2,12.6,Paid,,
Florida Panthers,2025-2026,18,pair1,129,26,24-25,2,86.94,Paid,,
Florida Panthers,2025-2026,18,pair2,308,8,1-2,2,27.67,Paid,,
Florida Panthers,2025-2026,18,pair3,325,5,6-7,2,43.2,Paid,,
Florida Panthers,2025-2026,19,pair1,129,26,24-25,2,1.0,Paid,,
Florida Panthers,2025-2026,19,pair2,308,8,1-2,2,28.62,Paid,,
Florida Panthers,2025-2026,19,pair3,325,5,6-7,2,45.0,Paid,,
Florida Panthers,2025-2026,20,pair1,129,26,24-25,2,1.0,Paid,,
Florida Panthers,2025-2026,20,pair2,308,8,1-2,2,31.39,Paid,,
Florida Panthers,2025-2026,20,pair3,325,5,6-7,2,34.2,Paid,,
Florida Panthers,2025-2026,21,pair1,129,26,24-25,2,75.6,Paid,,
Florida Panthers,2025-2026,21,pair2,308,8,1-2,2,54.41,Paid,,
Florida Panthers,2025-2026,21,pair3,325,5,6-7,2,68.4,Paid,,
Florida Panthers,2025-2026,22,pair1,129,26,24-25,2,144.18,Paid,,
Florida Panthers,2025-2026,22,pair2,308,8,1-2,2,301.72,Paid,,
Florida Panthers,2025-2026,22,pair3,325,5,6-7,2,145.8,Paid,,
Florida Panthers,2025-2026,23,pair1,129,26,24-25,2,232.96,Paid,,
Florida Panthers,2025-2026,23,pair2,308,8,1-2,2,121.05,Paid,,
Florida Panthers,2025-2026,23,pair3,325,5,6-7,2,108.0,Paid,,
Florida Panthers,2025-2026,24,pair1,129,26,24-25,2,298.26,Paid,,
Florida Panthers,2025-2026,24,pair2,308,8,1-2,2,154.03,Paid,,
Florida Panthers,2025-2026,24,pair3,325,5,6-7,2,144.13,Paid,,
Florida Panthers,2025-2026,25,pair1,129,26,24-25,2,200.25,Paid,,
Florida Panthers,2025-2026,25,pair2,308,8,1-2,2,92.39,Paid,,
Florida Panthers,2025-2026,25,pair3,325,5,6-7,2,81.81,Paid,,
Florida Panthers,2025-2026,26,pair1,129,26,24-25,2,98.0,Paid,,
Florida Panthers,2025-2026,26,pair2,308,8,1-2,2,33.73,Pending,,
Florida Panthers,2025-2026,26,pair3,325,5,6-7,2,36.9,Pending,,
Florida Panthers,2025-2026,27,pair1,129,26,24-25,2,99.0,Pending,,
Florida Panthers,2025-2026,27,pair2,308,8,1-2,2,99.0,Pending,,
Florida Panthers,2025-2026,27,pair3,325,5,6-7,2,66.28,Pending,,
Florida Panthers,2025-2026,28,pair1,129,26,24-25,2,34.9,Pending,,
Florida Panthers,2025-2026,28,pair2,308,8,1-2,2,120.6,Paid,,
Florida Panthers,2025-2026,28,pair3,325,5,6-7,2,128.25,Paid,,
Florida Panthers,2025-2026,29,pair1,129,26,24-25,2,130.36,Paid,,
Florida Panthers,2025-2026,29,pair3,325,5,6-7,2,36.0,Paid,,
Florida Panthers,2025-2026,29,pair2,308,8,1-2,2,29.7,Paid,,
Florida Panthers,2025-2026,30,pair1,129,26,24-25,2,403.2,Pending,,
Florida Panthers,2025-2026,30,pair2,308,8,1-2,2,97.85,Pending,,
Florida Panthers,2025-2026,30,pair3,325,5,6-7,2,108.52,Pending,,
Florida Panthers,2025-2026,31,pair1,129,26,24-25,2,208.37,Pending,,
Florida Panthers,2025-2026,31,pair2,308,8,1-2,2,90.0,Pending,,
Florida Panthers,2025-2026,32,pair2,308,8,1-2,2,72.41,Pending,,
Florida Panthers,2025-2026,32,pair1,129,26,24-25,2,166.09,Pending,,
Florida Panthers,2025-2026,p1,pair1,129,26,24-25,2,33.77,Paid,,
Florida Panthers,2025-2026,p1,pair2,308,8,1-2,2,18.2,Paid,,
Florida Panthers,2025-2026,p1,pair3,325,5,6-7,2,16.61,Paid,,
Florida Panthers,2025-2026,p2,pair1,129,26,24-25,2,37.48,Paid,,
Florida Panthers,2025-2026,p2,pair2,308,8,1-2,2,14.31,Paid,,
Florida Panthers,2025-2026,p2,pair3,325,5,6-7,2,21.6,Paid,,`;

const FileImportBox = ({ onImport, activePassId }: FileImportBoxProps) => {
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [isImportingText, setIsImportingText] = useState(false);
  const dropRef = useRef<View>(null);
  const { seasonPasses } = useSeasonPass ? useSeasonPass() : { seasonPasses: [] };
  // Add local state for selected pass if more than one
  const [selectedPassId, setSelectedPassId] = useState<string | null>(
    activePassId || (seasonPasses && seasonPasses.length === 1 ? seasonPasses[0].id : null)
  );
  // Update selectedPassId if passes change and only one exists
  useEffect(() => {
    if (seasonPasses.length === 1) setSelectedPassId(seasonPasses[0].id);
  }, [seasonPasses.length]);
  const effectivePassId = selectedPassId;
// ...existing code...

  const processFile = useCallback(async (content: string, fileName: string, isBase64: boolean = false) => {
    if (!effectivePassId) {
      Alert.alert('Error', 'No active season pass. Create or select a pass first.');
      return;
    }

    setStatus('parsing');
    setStatusMessage(`Parsing ${fileName}...`);
    console.log('[FileImport] Processing file:', fileName);

    try {
      let rows: TicketRow[] = [];
      const ext = fileName.toLowerCase().split('.').pop() || '';
      const trimmed = content.trimStart();

      if (isZipLikeContent(trimmed) || trimmed.startsWith('PK')) {
        console.log('[FileImport] Detected Excel/ZIP binary signature (PK) regardless of extension');
        setStatus('error');
        setStatusMessage('This file is an Excel/ZIP archive. Please save as CSV or JSON and re-import.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      if (ext === 'json') {
        rows = parseJSONContent(trimmed);
      } else if (ext === 'csv' || ext === 'tsv') {
        rows = parseCSVContent(trimmed);
      } else if (ext === 'xlsx' || ext === 'xls') {
        setStatus('error');
        setStatusMessage('Excel files are not supported. Please save as CSV or JSON and re-import.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      } else {
        if (isZipLikeContent(trimmed)) {
          setStatus('error');
          setStatusMessage('This looks like an Excel file. Please save as CSV or JSON and re-import.');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        }
        try {
          rows = parseJSONContent(trimmed);
        } catch {
          rows = parseCSVContent(trimmed);
        }
      }

      if (rows.length === 0) {
        setStatus('error');
        setStatusMessage('No valid sales data found in file. Check format.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      const uniqueSeats = new Set<string>();
      rows.forEach(r => r.tickets.forEach(t => uniqueSeats.add(`${t.section}|${t.row}`)));

      setStatus('importing');
      setStatusMessage(`Importing ${rows.length} sales across ${uniqueSeats.size} seat pairs...`);

      const result = await onImport(rows);

      if (result.success) {
        setStatus('success');
        let msg = `Imported ${result.salesCount} sales, ${result.seatPairsCount} seat pairs`;
        if (result.message) msg += `\n${result.message}`;
        setStatusMessage(msg);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setStatus('error');
        setStatusMessage(result.message || 'Import failed.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e: any) {
      console.error('[FileImport] processFile error:', e);
      setStatus('error');
      setStatusMessage(`Error: ${e?.message || 'Unknown error'}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [activePassId, onImport]);

  const handlePickFile = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'application/json',
          'text/csv',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });

      if (res.canceled || !res.assets || res.assets.length === 0) return;

      const asset = res.assets[0];
      const fileName = asset.name || 'unknown';
      const ext = fileName.toLowerCase().split('.').pop() || '';

      if (ext === 'xlsx' || ext === 'xls') {
        Alert.alert('Unsupported Format', 'Excel files (.xlsx/.xls) are not supported. Please save your spreadsheet as CSV or JSON and import that instead.');
        return;
      }

      let content: string;
      if (Platform.OS === 'web') {
        const response = await fetch(asset.uri);
        const buf = await response.arrayBuffer();
        const bytes = new Uint8Array(buf);
        if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B) {
          Alert.alert('Unsupported Format', 'This file is an Excel/ZIP archive. Please save your spreadsheet as CSV or JSON and import that instead.');
          return;
        }
        const decoder = new TextDecoder('utf-8');
        content = decoder.decode(buf);
      } else {
        content = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (content.startsWith('PK')) {
          Alert.alert('Unsupported Format', 'This file is an Excel/ZIP archive. Please save your spreadsheet as CSV or JSON and import that instead.');
          return;
        }
      }
      await processFile(content, fileName, false);
    } catch (e: any) {
      console.error('[FileImport] handlePickFile error:', e);
      Alert.alert('Error', 'Could not open file picker.');
    }
  }, [processFile]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      const fileName = file.name || 'unknown';
      const ext = fileName.toLowerCase().split('.').pop() || '';
      console.log('[FileImport] Dropped file:', fileName, 'type:', file.type, 'size:', file.size);

      if (ext === 'xlsx' || ext === 'xls') {
        Alert.alert('Unsupported Format', 'Excel files (.xlsx/.xls) are not supported. Please save your spreadsheet as CSV or JSON and import that instead.');
        return;
      }

      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B) {
        Alert.alert('Unsupported Format', 'This file is an Excel/ZIP archive. Please save your spreadsheet as CSV or JSON and import that instead.');
        return;
      }

      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(buf);
      await processFile(text, fileName, false);
    };

    const el = document.getElementById('file-import-drop-zone');
    if (el) {
      el.addEventListener('dragover', handleDragOver);
      el.addEventListener('dragleave', handleDragLeave);
      el.addEventListener('drop', handleDrop);
      return () => {
        el.removeEventListener('dragover', handleDragOver);
        el.removeEventListener('dragleave', handleDragLeave);
        el.removeEventListener('drop', handleDrop);
      };
    }
  }, [processFile]);

  const resetStatus = useCallback(() => {
    setStatus('idle');
    setStatusMessage('');
  }, []);

  const isProcessing = status === 'parsing' || status === 'importing';

  return (
    <View style={styles.container}>
      {seasonPasses.length > 1 && (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>Select Season Pass to Import Into:</Text>
          <Picker
            selectedValue={selectedPassId}
            onValueChange={setSelectedPassId}
            style={{ backgroundColor: '#F3F4F6', borderRadius: 8 }}
          >
            {seasonPasses.map(pass => (
              <Picker.Item key={pass.id} label={pass.teamName + ' (' + (pass.seasonLabel || pass.id) + ')'} value={pass.id} />
            ))}
          </Picker>
        </View>
      )}
      <View style={styles.headerRow}>
        <FileSpreadsheet size={18} color="#059669" />
        <Text style={styles.title}>Import Sales File</Text>
      </View>
      <Text style={styles.subtitle}>
        Drop or select a JSON, CSV, or Excel file to replace sales data
      </Text>

      <TouchableOpacity
        onPress={isProcessing ? undefined : handlePickFile}
        disabled={isProcessing || !effectivePassId}
        activeOpacity={0.7}
        style={[
          styles.dropZone,
          isDragOver && styles.dropZoneActive,
          status === 'success' && styles.dropZoneSuccess,
          status === 'error' && styles.dropZoneError,
          !effectivePassId && { opacity: 0.5 },
        ]}
        testID="fileImportBox.dropZone"
      >
        <View
          ref={dropRef}
          nativeID="file-import-drop-zone"
          style={styles.dropZoneInner}
        >
          {isProcessing ? (
            <ActivityIndicator size="large" color="#059669" />
          ) : status === 'success' ? (
            <Check size={32} color="#059669" />
          ) : status === 'error' ? (
            <AlertTriangle size={32} color="#DC2626" />
          ) : (
            <Upload size={32} color={isDragOver ? '#059669' : '#9CA3AF'} />
          )}

          <Text style={[
            styles.dropText,
            status === 'success' && { color: '#059669' },
            status === 'error' && { color: '#DC2626' },
          ]}>
            {isProcessing
              ? statusMessage
              : status === 'success'
              ? statusMessage
              : status === 'error'
              ? statusMessage
              : Platform.OS === 'web'
              ? 'Drag & drop file here, or tap to browse'
              : 'Tap to select a file'}
          </Text>

          <Text style={styles.formatHint}>
            Supports: .json, .csv
          </Text>
        </View>
      </TouchableOpacity>

      <Text style={{ marginVertical: 8, fontWeight: 'bold', textAlign: 'center' }}>OR</Text>
      {Platform.OS === 'web' ? (
        <textarea
          style={{
            minHeight: 100,
            width: '100%',
            borderColor: '#ccc',
            borderWidth: 1,
            borderRadius: 8,
            padding: 8,
            marginBottom: 8,
            fontFamily: 'monospace',
            resize: 'vertical',
          }}
          placeholder="Paste CSV data here..."
          value={pastedText}
          onChange={e => setPastedText(e.target.value)}
          disabled={isImportingText || isProcessing}
        />
      ) : (
        <TextInput
          style={{
            minHeight: 100,
            borderColor: '#ccc',
            borderWidth: 1,
            borderRadius: 8,
            padding: 8,
            marginBottom: 8,
            fontFamily: 'monospace',
          }}
          multiline
          placeholder="Paste CSV data here..."
          value={pastedText}
          onChangeText={setPastedText}
          editable={!isImportingText && !isProcessing}
          autoCapitalize="none"
          autoCorrect={false}
        />
      )}
      <TouchableOpacity
        style={[styles.resetButton, { backgroundColor: '#059669', marginBottom: 8 }]}
        onPress={async () => {
          setIsImportingText(true);
          setStatus('parsing');
          setStatusMessage('Parsing pasted text...');
          try {
            const rows = parseCSVContent(pastedText);
            if (!rows.length) throw new Error('No valid data found in pasted text.');
            setStatus('importing');
            setStatusMessage('Importing pasted data...');
            // Patch: Use replaceSalesDataFromPastedSeed for full sales log replacement
            if (typeof window !== 'undefined' && (window as any).SeasonPassProvider && (window as any).SeasonPassProvider.replaceSalesDataFromPastedSeed) {
              const result = await (window as any).SeasonPassProvider.replaceSalesDataFromPastedSeed(pastedText, effectivePassId);
              setStatus(result.success ? 'success' : 'error');
              setStatusMessage(result.message || (result.success ? 'Import successful!' : 'Import failed.'));
            } else {
              // Fallback: Use onImport for environments where provider is not exposed
              const result = await onImport(rows);
              setStatus(result.success ? 'success' : 'error');
              setStatusMessage(result.message || (result.success ? 'Import successful!' : 'Import failed.'));
            }
          } catch (err: any) {
            setStatus('error');
            setStatusMessage(err.message || 'Import failed.');
          } finally {
            setIsImportingText(false);
          }
        }}
        disabled={isImportingText || isProcessing || !pastedText.trim() || !effectivePassId}
      >
        <Text style={{ color: '#fff', fontWeight: 'bold' }}>{isImportingText ? 'Importing...' : 'Import Pasted CSV Text'}</Text>
      </TouchableOpacity>

      {(status === 'success' || status === 'error') && (
        <TouchableOpacity
          style={styles.resetButton}
          onPress={resetStatus}
          testID="fileImportBox.reset"
        >
          <Text style={styles.resetButtonText}>
            {status === 'success' ? 'Import Another' : 'Try Again'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default FileImportBox;

const styles = StyleSheet.create({
  container: {
    backgroundColor: AppColors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: AppColors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: AppColors.textSecondary,
    marginBottom: 14,
    fontWeight: '500' as const,
  },
  dropZone: {
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed' as const,
    borderRadius: 14,
    overflow: 'hidden' as const,
  },
  dropZoneActive: {
    borderColor: '#059669',
    backgroundColor: '#ECFDF5',
  },
  dropZoneSuccess: {
    borderColor: '#059669',
    borderStyle: 'solid' as const,
    backgroundColor: '#F0FDF4',
  },
  dropZoneError: {
    borderColor: '#DC2626',
    borderStyle: 'solid' as const,
    backgroundColor: '#FEF2F2',
  },
  dropZoneInner: {
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
  },
  dropText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#6B7280',
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  formatHint: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500' as const,
  },
  resetButton: {
    marginTop: 10,
    alignSelf: 'center' as const,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
  },
  resetButtonText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#374151',
  },
});
