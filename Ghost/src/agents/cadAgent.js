const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const OUTPUT_DIR = path.join(__dirname, '../../outputs/cad');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── DXF Builder ──────────────────────────────────────────────────────────────
function dxfHeader() {
  return `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`;
}
function dxfFooter() { return `0\nENDSEC\n0\nEOF\n`; }

function dxfLine(x1,y1,x2,y2,layer='0') {
  return `0\nLINE\n8\n${layer}\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;
}
function dxfRect(x,y,w,h,layer='0') {
  return dxfLine(x,y,x+w,y,layer)+dxfLine(x+w,y,x+w,y+h,layer)+dxfLine(x+w,y+h,x,y+h,layer)+dxfLine(x,y+h,x,y,layer);
}
function dxfCircle(x,y,r,layer='0') {
  return `0\nCIRCLE\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0\n40\n${r}\n`;
}
function dxfText(x,y,text,height=0.5,layer='TEXT') {
  return `0\nTEXT\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0\n40\n${height}\n1\n${text}\n`;
}
function dxfArc(x,y,r,startAngle,endAngle,layer='0') {
  return `0\nARC\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0\n40\n${r}\n50\n${startAngle}\n51\n${endAngle}\n`;
}

// ── Geometry Generators ───────────────────────────────────────────────────────
function generateFloorPlan(params) {
  const { width=10, height=8, rooms=[], doors=2, windows=4 } = params;
  let entities = '';
  // Outer walls
  entities += dxfRect(0,0,width,height,'WALLS');
  // Label
  entities += dxfText(width/2-1, height/2, `${width}x${height}m`, 0.4, 'TEXT');
  // Rooms
  if (rooms.length) {
    rooms.forEach((r,i) => {
      entities += dxfRect(r.x||0, r.y||0, r.w||width/2, r.h||height/2, 'ROOMS');
      entities += dxfText((r.x||0)+0.3, (r.y||0)+0.3, r.name||`Room ${i+1}`, 0.3, 'TEXT');
    });
  }
  // Doors (gaps in wall)
  for (let i=0;i<doors;i++) {
    const dx = (width/(doors+1))*(i+1);
    entities += dxfArc(dx, 0, 1, 0, 90, 'DOORS');
    entities += dxfText(dx-0.2, -0.8, 'D', 0.3, 'TEXT');
  }
  // Windows
  for (let i=0;i<windows;i++) {
    const wx = (width/(windows/2+1))*((i%Math.ceil(windows/2))+1);
    const wy = i < windows/2 ? 0 : height;
    entities += dxfLine(wx-0.5, wy, wx+0.5, wy, 'WINDOWS');
    entities += dxfLine(wx-0.5, wy, wx-0.5, wy+(i<windows/2?0.1:-0.1), 'WINDOWS');
    entities += dxfLine(wx+0.5, wy, wx+0.5, wy+(i<windows/2?0.1:-0.1), 'WINDOWS');
  }
  return entities;
}

function generateRoad(params) {
  const { length=100, width=7, footpath=2, lanes=2 } = params;
  let entities = '';
  const total = width + footpath*2;
  // Footpaths
  entities += dxfRect(0, 0, length, footpath, 'FOOTPATH');
  entities += dxfRect(0, footpath+width, length, footpath, 'FOOTPATH');
  // Road
  entities += dxfRect(0, footpath, length, width, 'ROAD');
  // Lane dividers
  for (let i=1;i<lanes;i++) {
    const ly = footpath + (width/lanes)*i;
    for (let x=0;x<length;x+=5) {
      entities += dxfLine(x, ly, x+3, ly, 'LANES');
    }
  }
  // Labels
  entities += dxfText(length/2-5, footpath+width/2-0.2, `Road ${width}m`, 0.4, 'TEXT');
  entities += dxfText(length/2-5, footpath/2-0.2, `Footpath ${footpath}m`, 0.3, 'TEXT');
  entities += dxfText(2, -1, `Total width: ${total}m, Length: ${length}m`, 0.4, 'TEXT');
  return entities;
}

function generateSitePlan(params) {
  const { plotW=20, plotH=30, setback=3, buildingW, buildingH } = params;
  const bw = buildingW || plotW-(setback*2);
  const bh = buildingH || plotH-(setback*2);
  let entities = '';
  entities += dxfRect(0,0,plotW,plotH,'PLOT');
  entities += dxfRect(setback,setback,bw,bh,'BUILDING');
  entities += dxfText(setback+0.5, setback+0.5, `Building ${bw}x${bh}m`, 0.4, 'TEXT');
  // Setback lines (dashed represented as short lines)
  for (let x=0;x<plotW;x+=1.5) {
    entities += dxfLine(x, setback, x+0.8, setback, 'SETBACK');
    entities += dxfLine(x, plotH-setback, x+0.8, plotH-setback, 'SETBACK');
  }
  entities += dxfText(1, -1.5, `Plot: ${plotW}x${plotH}m | Setback: ${setback}m`, 0.4, 'TEXT');
  return entities;
}

function generateColumn(params) {
  const { size=0.45, spacing=5, rows=3, cols=4 } = params;
  let entities = '';
  for (let r=0;r<rows;r++) {
    for (let c=0;c<cols;c++) {
      const x = c*spacing, y = r*spacing;
      entities += dxfRect(x-size/2, y-size/2, size, size, 'COLUMNS');
      entities += dxfText(x-0.15, y-0.1, `C${r*cols+c+1}`, 0.2, 'TEXT');
    }
  }
  entities += dxfText(0, -1.5, `Column grid ${cols}x${rows} @ ${spacing}m c/c`, 0.4, 'TEXT');
  return entities;
}

// ── LLM Parser ────────────────────────────────────────────────────────────────
async function parseIntent(description) {
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: `Parse CAD drawing requests into JSON. Return ONLY JSON.
Types: floor_plan, road, site_plan, column_grid
Examples:
- "10x8 room 2 doors 4 windows" → {"type":"floor_plan","width":10,"height":8,"doors":2,"windows":4}
- "road 200m long 7m wide 2m footpath" → {"type":"road","length":200,"width":7,"footpath":2}
- "site plan 20x30 plot 3m setback" → {"type":"site_plan","plotW":20,"plotH":30,"setback":3}
- "column grid 4x3 at 5m spacing" → {"type":"column_grid","cols":4,"rows":3,"spacing":5}` },
      { role: 'user', content: description }
    ],
    temperature: 0.1, max_tokens: 256
  });
  try {
    return JSON.parse(res.choices[0].message.content.replace(/```json|```/g,'').trim());
  } catch { return { type: 'floor_plan', width: 10, height: 8 }; }
}

// ── Main run ──────────────────────────────────────────────────────────────────
async function run(description) {
  const params = await parseIntent(description);
  let entities = '';
  let filename = '';

  switch(params.type) {
    case 'road':
      entities = generateRoad(params);
      filename = `road_${params.length||100}m.dxf`;
      break;
    case 'site_plan':
      entities = generateSitePlan(params);
      filename = `site_plan_${params.plotW||20}x${params.plotH||30}.dxf`;
      break;
    case 'column_grid':
      entities = generateColumn(params);
      filename = `column_grid_${params.cols||4}x${params.rows||3}.dxf`;
      break;
    default:
      entities = generateFloorPlan(params);
      filename = `floor_plan_${params.width||10}x${params.height||8}.dxf`;
  }

  const dxf = dxfHeader() + entities + dxfFooter();
  const outPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outPath, dxf);

  return {
    success: true,
    file: outPath,
    type: params.type,
    params,
    text: `CAD file generated: ${filename}\nSaved to: ${outPath}\nOpen in AutoCAD, FreeCAD, or any DXF viewer.`
  };
}

module.exports = { run };
