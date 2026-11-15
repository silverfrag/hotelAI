// Exercise the actual server pages without starting a server or using live data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const swc = require('next/dist/build/swc');
const root = path.resolve(__dirname, '..');
const jsx = (_type, props) => ({ props });

(async()=>{
  for (const route of ['page.tsx', 'rooms/page.tsx']) {
    let catalog=[{type_id:98}], failure=null, mappingCalls=0, connections=0;
    const dependencies={
      'next/server':{connection:async()=>{connections++;}},
      'react/jsx-runtime':{jsx,jsxs:jsx},
      '@/services/room.service':{getRoomTypes:async()=>{if(failure)throw failure;return catalog;}},
      '@/services/room-presentation':{mapApiRoomToPresentation:room=>{mappingCalls++;return {id:room.type_id};}},
      '@/utils/businessDate':{getHotelBusinessDate:()=> '2026-09-16'},
      '@/components/features/figma/HomeView':{default:()=>null},
      '@/components/features/figma/RoomsView':{default:()=>null},
    };
    const filename=path.join(root,'src/app/(public)',route);
    const mod=new Module(filename,module);
    mod.require=name=>{assert.ok(name in dependencies,`Unexpected dependency: ${name}`);return dependencies[name];};
    mod._compile(swc.transformSync(fs.readFileSync(filename,'utf8'),{
      filename,jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'},
    }).code,filename);
    const render=mod.exports.default;
    let page=await render();
    assert.deepEqual(page.props.rooms,[{id:98}]);assert.equal(page.props.catalogError,false);
    failure=new Error('Core unavailable');page=await render();
    assert.deepEqual(page.props.rooms,[]);assert.equal(page.props.catalogError,true);
    assert.equal(mappingCalls,1,'Failed catalog never fabricates bookable rooms');
    failure=null;catalog=[];page=await render();
    assert.deepEqual(page.props.rooms,[]);assert.equal(page.props.catalogError,false,'A truly empty catalog is distinct from an outage');
    catalog=[{type_id:99}];page=await render();assert.deepEqual(page.props.rooms,[{id:99}]);
    assert.equal(connections,4,'Catalog is resolved at request time');
  }
  console.log('PASS: Home/Rooms use actual catalog, distinguish outage/empty state and recover without invented rooms.');
})().catch(error=>{console.error(error);process.exitCode=1;});
