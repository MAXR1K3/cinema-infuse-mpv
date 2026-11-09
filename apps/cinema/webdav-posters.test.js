const test=require('node:test'),assert=require('node:assert/strict');const {davMediaLabel,chooseDavPoster,matchDavMetadata}=require('./webdav-posters');
test('poster wall labels retain title, year and episode without release tags',()=>{
 assert.deepEqual(davMediaLabel('Dune.Part.Two.2024.2160p.HEVC.mkv'),{title:'Dune Part Two',year:'2024',episode:''});
 assert.equal(davMediaLabel('金字塔游戏.S01E04.1080p.mkv').episode,'S01E04');
 assert.equal(davMediaLabel('我的片库',true).title,'我的片库');
 assert.equal(davMediaLabel('[黑袍纠察队 第一季][01-08TV全集][1080P][HEVC]',true).title,'黑袍纠察队');
 assert.equal(davMediaLabel('[DBD-Raws][黑袍纠察队 第一季][01-08TV全集][1080P]',true).title,'黑袍纠察队');
 assert.equal(davMediaLabel('『 不太灵免费影视站 www.butailing.com 』足球教练 第二季[杜比视界版本][全12集] Ted Lasso 2021',true).title,'足球教练');
 assert.equal(davMediaLabel('杀人者的购物中心[杜比视界版本][全8集][简繁英字幕]',true).title,'杀人者的购物中心');
});
test('native posters are selected by exact filename, generic artwork only for single movie folders',()=>{
 const a={name:'A.mkv',video:true},b={name:'B.mkv',video:true},poster={name:'poster.jpg'},same={name:'A-poster.png'};
 assert.equal(chooseDavPoster(a,[a,b,poster]),null);assert.equal(chooseDavPoster(a,[a,b,same]),same);assert.equal(chooseDavPoster(a,[a,poster]),poster);assert.equal(chooseDavPoster({directory:true,name:'Movie'},[a,poster]),poster);
});
test('metadata matching rejects partial names, wrong years and ambiguous editions',()=>{
 const movie={Type:'Movie',Name:'沙丘2',OriginalTitle:'Dune Part Two',ProductionYear:2024,ImageTags:{Primary:'p'}};
 assert.equal(matchDavMetadata({title:'Dune Part Two',year:'2024'},[movie]),movie);
 const series={...movie,Type:'Series',ProductionYear:2020};assert.equal(matchDavMetadata({title:'沙丘2',year:'2021',episode:'第二季'},[series]),series);
 assert.equal(matchDavMetadata({title:'Dune',year:'2024'},[movie]),null);assert.equal(matchDavMetadata({title:'沙丘2',year:'2023'},[movie]),null);assert.equal(matchDavMetadata({title:'沙丘2'},[movie,{...movie}]),null);
});

test('folder-named posters and inherited series names work for numbered episode files',()=>{
 const {davMetadataLabels}=require('./webdav-posters');const folder={name:'Dune.Part.Two.2024',directory:true},image={name:'Dune.Part.Two.2024-poster.jpg'};assert.equal(chooseDavPoster(folder,[image]),image);
 assert.deepEqual(davMetadataLabels({name:'01.mkv',directory:false,path:'/dav/%E9%87%91%E5%AD%97%E5%A1%94%E6%B8%B8%E6%88%8F/Season%201/01.mkv'}).map(x=>x.title),['金字塔游戏']);
 assert.deepEqual(davMetadataLabels({name:'Other.Movie.2020.mkv',path:'/dav/Dune/Other.Movie.2020.mkv'}).map(x=>x.title),['Other Movie']);
});
