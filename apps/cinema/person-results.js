(function(root){
 function createLatestPersonRequest(fetchPage){
  let sequence=0;
  return {
   cancel(){sequence++;},
   async load(query,commit){
    const current=++sequence;
    try{const data=await fetchPage(query);if(current!==sequence)return false;commit(data);return true;}
    catch(error){if(current===sequence)throw error;return false;}
   }
  };
 }
 if(typeof module==='object' && module.exports)module.exports={createLatestPersonRequest};
 else root.createLatestPersonRequest=createLatestPersonRequest;
})(typeof window==='object'?window:this);
