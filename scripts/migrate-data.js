import fs from 'node:fs';
const input=process.argv.includes('--input')?process.argv[process.argv.indexOf('--input')+1]:'export.json';
const dryRun=process.argv.includes('--dry-run');
const source=JSON.parse(fs.readFileSync(input,'utf8'));
const vendors={...(source.pending_vendors||{}),...(source.approved_vendors||{}),...(source.vendors||{})};
const output={vendors:{},products:{}};
for(const [id,vendor] of Object.entries(vendors)){
  output.vendors[id]={ownerUid:vendor.ownerUid||id,businessName:vendor.name||vendor.businessName||'Unnamed vendor',email:vendor.email||'',phone:vendor.phone||'',whatsapp:vendor.whatsapp||'',categoryId:vendor.mainCategory||vendor.categoryId||'general',description:vendor.description||'',status:'ACTIVE'};
  if(vendor.featuredItem&&typeof vendor.featuredItem==='object') output.products[`${id}-featured`]={vendorId:id,ownerUid:vendor.ownerUid||id,name:vendor.featuredItem.name||'Unnamed product',description:vendor.featuredItem.description||'',image:vendor.featuredItem.image||'',categoryId:vendor.mainCategory||'general',status:'PUBLISHED'};
}
const result=JSON.stringify({summary:{vendors:Object.keys(output.vendors).length,products:Object.keys(output.products).length},data:output},null,2);
if(dryRun) console.log(result); else fs.writeFileSync('migrated-output.json',result);
