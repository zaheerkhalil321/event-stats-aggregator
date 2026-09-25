import { createClient } from '@libsql/client';
import fs from 'fs';
import { execSync } from 'child_process';

let envFile = '';
if (fs.existsSync('.env')) envFile = fs.readFileSync('.env', 'utf8');
else if (fs.existsSync('../.env')) envFile = fs.readFileSync('../.env', 'utf8');

const tursoUrl = process.env.TURSO_DATABASE_URL || envFile.match(/TURSO_DATABASE_URL=(.+)/)?.[1]?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN || envFile.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1]?.trim();

const client = createClient({
  url: tursoUrl,
  authToken: tursoToken,
});

// Run swift script to get raw lines
const swiftCode = `
import Foundation
import Vision
import AppKit

func ocr(path: String) -> [String] {
    let url = URL(fileURLWithPath: path)
    guard let img = NSImage(contentsOf: url),
          let cgImg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return [] }
    
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    let handler = VNImageRequestHandler(cgImage: cgImg, options: [:])
    try? handler.perform([req])
    
    guard let results = req.results else { return [] }
    return results.compactMap { $0.topCandidates(1).first?.string }
}

let dir = "/Users/mzaheer/Downloads/working-projects/event-stats-aggregator/2025"
let files = try! FileManager.default.contentsOfDirectory(atPath: dir).filter { $0.hasSuffix(".png") }.sorted()
for f in files {
    print("FILE:" + f)
    for line in ocr(path: "\\(dir)/\\(f)") {
        print(line)
    }
}
`;

fs.writeFileSync('/tmp/ocr.swift', swiftCode);
const ocrOutput = execSync('swift /tmp/ocr.swift').toString();

const lines = ocrOutput.split('\n').map(l => l.trim()).filter(Boolean);

const trainRoxRaces = [];
const seenNames = new Set();

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith('HYROX ') && (line.includes('2025') || lines[i+1]?.includes('2025'))) {
    const rawName = line;
    let dateLine = lines[i + 1] || '';
    let countLine = lines[i + 2] || '';
    
    // If next line is not date, maybe part of name
    if (!dateLine.includes('2025') && lines[i+2]?.includes('2025')) {
      dateLine = lines[i + 2];
      countLine = lines[i + 3] || '';
    }

    const countMatch = countLine.match(/([\d,]+)\s*athletes/i) || lines[i+3]?.match(/([\d,]+)\s*athletes/i);
    const athleteCount = countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : null;

    // Deduplicate by clean race name + date
    const cleanName = rawName.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').trim();
    const key = `${cleanName}|${dateLine}`;
    if (!seenNames.has(key) && cleanName.includes('2025')) {
      seenNames.add(key);
      trainRoxRaces.push({
        name: cleanName,
        dateStr: dateLine,
        trainRoxAthletes: athleteCount
      });
    }
  }
}

console.log(`Extracted ${trainRoxRaces.length} unique 2025 races from TrainRox screenshots:\n`);

async function compareWithDb() {
  const dbRacesRes = await client.execute("SELECT id, name, date, end_date, athletes_count FROM hyrox_races ORDER BY date ASC");
  const dbRaces = dbRacesRes.rows;

  const comparison = [];

  for (const tr of trainRoxRaces) {
    // match by city name
    const trCity = tr.name.replace(/HYROX\s*/i, '').replace(/2025.*/, '').trim().toLowerCase();
    
    // Find in DB
    const matched = dbRaces.find(r => {
      const rId = r.id.toLowerCase();
      const rName = r.name.toLowerCase();
      // Match city and 2025
      return (rId.includes(trCity) || rName.includes(trCity)) && (r.date.startsWith('2025') || r.id.includes('2025'));
    });

    comparison.push({
      trainRoxName: tr.name,
      trainRoxDate: tr.dateStr,
      trainRoxCount: tr.trainRoxAthletes,
      dbId: matched ? matched.id : '❌ MISSING IN DB',
      dbDate: matched ? (matched.end_date ? `${matched.date} to ${matched.end_date}` : matched.date) : 'N/A',
      dbCount: matched ? matched.athletes_count : 'N/A',
      diff: matched && tr.trainRoxAthletes ? (matched.athletes_count - tr.trainRoxAthletes) : 'N/A'
    });
  }

  console.table(comparison);
  fs.writeFileSync('trainrox_comparison.json', JSON.stringify(comparison, null, 2));
}

compareWithDb();
