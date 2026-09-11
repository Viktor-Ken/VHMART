import fs from 'node:fs';
const [sourceFile,migratedFile]=process.argv.slice(2);
if(!sourceFile||!migratedFile){console.error('Usage: node scripts/migration-report.js source-export.json migrated-output.json');process.exit(1);}
const source=JSON.parse(fs.readFileSync(sourceFile,'utf8'));const migratedDocument=JSON.parse(fs.readFileSync(migratedFile,'utf8'));const migrated=migratedDocument.data||migratedDocument;
const oldVendors={...(source.pending_vendors||{}),...(source.approved_vendors||{}),...(source.vendors||{})};
const oldProducts=Object.fromEntries(Object.entries(oldVendors).filter(([,vendor])=>vendor.featuredItem).map(([id,vendor])=>[`${id}-featured`,vendor.featuredItem]));
const report={oldVendorCount:Object.keys(oldVendors).length,newVendorCount:Object.keys(migrated.vendors||{}).length,oldProductCount:Object.keys(oldProducts).length,newProductCount:Object.keys(migrated.products||{}).length,missingVendors:Object.keys(oldVendors).filter((id)=>!migrated.vendors?.[id]),missingProducts:Object.keys(oldProducts).filter((id)=>!migrated.products?.[id])};
console.log(JSON.stringify(report,null,2));
