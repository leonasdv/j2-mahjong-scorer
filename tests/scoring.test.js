const J2=require('../public/scoring.js');
const ctx=(o={})=>({seatWind:0,roundWind:0,seatNo:1,selfDraw:false,extras:{},...o});
const show=(label,h,c)=>{const r=J2.score(h,c);console.log('\n##',label,'=>',r.ok?`${r.structure} base ${r.base} total ${r.total}${r.kv3?' KV3':''}`:r.error);if(r.ok)console.log(r.items.map(i=>`#${i.no} ${i.name} ${i.pts}`).join(' | '));return r;};
const s=x=>x.split(' ');
// simple all chows no joker, self draw concealed
show('all chows concealed selfdraw',{joker:'5p',flowers:[],exposed:[],concealed:s('1m 2m 3m 4s 5s 6s 7s 8s 9s 2p 3p 4p 8m 8m')},ctx({selfDraw:true}));
// joker natural 4-5-6p
show('joker natural 456p',{joker:'5p',flowers:['rf1','bf2'],exposed:[{tiles:s('E E E')}],concealed:s('4p 5p 6p 1m 2m 3m 7s 8s 9s 2m 2m')},ctx());
// pair of 5p natural joker pair
show('natural joker pair',{joker:'5p',flowers:[],exposed:[],concealed:s('1m 2m 3m 4s 5s 6s 7s 8s 9s 2p 3p 4p 5p 5p')},ctx());
// seven pairs one suit 2-8m
show('7 pairs special',{joker:'5p',flowers:[],exposed:[],concealed:s('2m 2m 3m 3m 4m 4m 5m 5m 6m 6m 7m 7m 8m 8m')},ctx());
show('7 pairs common',{joker:'5p',flowers:[],exposed:[],concealed:s('1p 1p 3p 3p 7s 7s 9s 9s RD RD E E 2m 2m')},ctx());
// thirteen orphans
show('13 orphans',{joker:'5p',flowers:[],exposed:[],concealed:s('1m 9m 1p 9p 1s 9s E S W N RD GD WD 1m')},ctx());
// big three dragons w/ KV3: 2 exposed dragon pongs, discard
show('big 3 dragons KV3',{joker:'5p',flowers:[],exposed:[{tiles:s('GD GD GD')},{tiles:s('RD RD RD')}],concealed:s('WD WD WD 1m 2m 3m 9s 9s')},ctx());
// nine gates
show('nine gates',{joker:'5p',flowers:[],exposed:[],concealed:s('1m 1m 1m 2m 3m 4m 5m 6m 7m 8m 9m 9m 9m 5m')},ctx());
// four kongs
show('four kongs',{joker:'5p',flowers:[],exposed:[{tiles:s('8p 8p 8p 8p')},{tiles:s('6s 6s 6s 6s')},{tiles:s('2m 2m 2m 2m')},{tiles:s('GD GD GD GD'),concealedKong:true}],concealed:s('9s 9s')},ctx());
// 4 jokers with structure
show('4 jokers structure',{joker:'5p',flowers:[],exposed:[],concealed:s('5p 2m 3m 1p 5p 3p 7s 5p 9s 9m 9m 9m 5p 1s')},ctx());
show('4 jokers instant',{joker:'5p',flowers:[],exposed:[],concealed:s('5p 5p 5p 5p')},ctx({instant4J:true}));
// small four winds
show('small four winds',{joker:'5p',flowers:[],exposed:[],concealed:s('E E E S S S N N N 1m 2m 3m W W')},ctx({selfDraw:true}));
// invalid
show('invalid',{joker:'5p',flowers:[],exposed:[],concealed:s('1m 2m 4m 4s 5s 6s 7s 8s 9s 2p 3p 4p 8m 8m')},ctx());
console.log(J2.settle(10,4,0,2,false,'losers-pay'), J2.settle(10,4,0,null,true,'losers-pay'));
// flower joker: red flowers are the jokers; seated 2nd, black flower 2 still scores as an own-seat black flower
show('flower joker, black own seat',{joker:'rf1',flowers:['bf2'],exposed:[],concealed:s('1m 2m 3m 4s 5s 6s 7s 8s 9s 2p 3p 4p 8m 8m')},ctx({seatNo:2}));
show('flower joker rf1 + bf2 fills gap',{joker:'rf1',flowers:['bf2','rf3'],exposed:[],concealed:s('1m 2m 3m 4s 5s 6s 7s 8s 9s 2p 3p 4p 8m')},ctx({seatNo:2}));
show('flower joker, short with no flower',{joker:'rf1',flowers:['bf2'],exposed:[],concealed:s('1m 2m 3m 4s 5s 6s 7s 8s 9s 2p 3p 4p 8m')},ctx({seatNo:2}));
show('flower joker pads exposed pair',{joker:'bf4',flowers:['bf4'],exposed:[{tiles:s('7p 7p')}],concealed:s('1m 2m 3m 4s 5s 6s 2p 3p 4p 8m 8m')},ctx());
// opened sets inside the hand: marking one ends the fully-concealed rules (#19, #38)
{
  const hand={joker:'9p',flowers:[],exposed:[],concealed:s('2m 2m 2m 5s 5s 5s 7p 7p 7p 3s 3s 3s 8m 8m')};
  const full=J2.score(hand,ctx({selfDraw:true})), open=J2.score(hand,ctx({selfDraw:true,opened:[{type:'pong',k:J2.IDX['2m']}]}));
  const has=(r,n)=>r.items.some(i=>i.no===n);
  if(!(has(full,38)&&has(full,19)&&!has(open,38)&&!has(open,19)&&has(open,28))) throw new Error('opened set should end #19/#38');
  const bad=J2.score(hand,ctx({opened:[{type:'chow',k:0}]}));
  if(bad.ok) throw new Error('an opened set that is not in the hand should be rejected');
  console.log('\n## opened sets: ok');
}
