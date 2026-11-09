const test=require('node:test'),assert=require('node:assert/strict');const {seriesStatus}=require('./series-status');
test('series status distinguishes ended, ongoing schedules and missing information',()=>{
 assert.equal(seriesStatus({Type:'Movie',Status:'Ended'}),null);
 assert.equal(seriesStatus({Type:'Series',Status:'Ended',AirDays:['Friday'],AirTime:'20:00'}).schedule,'');
 assert.equal(seriesStatus({Type:'Series',Status:'Continuing',AirDays:['Friday','Saturday'],AirTime:'20:00'}).schedule,'每周五、周六 20:00（播出地时间）');
 assert.equal(seriesStatus({Type:'Series'}).label,'状态待补充');assert.equal(seriesStatus({Type:'Series',EndDate:'2099-01-01'}).label,'状态待补充');
 assert.equal(seriesStatus({Type:'Series',Status:'Continuing',DateCreated:'2099-01-01'}).nextAirDate,'');
 assert.equal(seriesStatus({Type:'Series',Status:'Continuing',NextEpisodeAirDate:'2099-01-01'}).nextAirDate,'2099-01-01T00:00:00.000Z');
});

test('local matched episodes retain broadcast information without changing playback identity',()=>{const {enrichDetailItem}=require('./detail-presentation');const status={label:'连载中'};const item=enrichDetailItem({id:'local',source:'local',embyId:'123'},{id:'emby-123',seriesStatus:status});assert.equal(item.id,'local');assert.deepEqual(item.seriesStatus,status);});
