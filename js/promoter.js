const DELAY_PERIOD = 60; // seconds
const TRYTE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ9";

function Promoter({ iotaObj, curlObj }) {

  this.iota = iotaObj;
  this.curl = curlObj;

  const generateSeed = () => {
    return Array(81).join().split(',')
      .map(() => TRYTE_ALPHABET.charAt(Math.floor(Math.random() * TRYTE_ALPHABET.length))).join('');
  }

  this.sendingSeed = generateSeed();
  this.sendingAddress = null;
  this.inputs = null;
  this.trytes = null;
  this.promoting = false;
  this.initialized = false;
  this.promotionCount = 0;

  this.getNewAddress = (seed) => new Promise((resolve, reject) => {
    iotaObj.api.getNewAddress(seed, (error, result) => {
      if (error) {
        reject(error)
      } else {
        resolve(result);
      }
    });
  });

  this.getTransactionToPromote = () => new Promise((resolve, reject) => {
    // var request = new Request('https://api.thetangle.org/v1/transactions/history/5');
    // fetch(request)
    //   .then(response => response.json())
    //   .then(responseObj => {
    //     const hashToPromote = responseObj.positiveTransactions[0].hash;
    //     console.log(`Trx to promote: ${hashToPromote}`);
    //     resolve(hashToPromote);
    //   });
    resolve();
  });

  this.checkReference = transactionHash => new Promise((resolve, reject) => {
    if (!transactionHash) {
      resolve({ confirmed: true });
    } else {
      iotaObj.api.isPromotable(transactionHash).then(promotable => {
        if(!promotable) {
          console.log(`%cUnpromotable transaction ${transactionHash}`, "background: grey; font-size: x-large");
          resolve({ promotable: false, confirmed: false });
        } else {
          iotaObj.api.getLatestInclusion([transactionHash], (error, result) => {
            if (error) {
              reject(error);
            } else {
              const confirmed = result[0];
              if (confirmed) {
                console.log(`%cTransaction confirmed: ${transactionHash}`, "background: yellow; font-size: x-large");
              }
              resolve({ promotable: !confirmed, confirmed: confirmed });
            }
          });
        }
      });
    }
  });

  this.singlePromote = (referenceHash) => new Promise((resolve, reject) => {
    const transaction = new Transaction({ 
      iotaObj, 
      curlObj, 
      sendingSeed: this.sendingSeed
    });
    transaction.sendTransfer(referenceHash).then(tx => {
      const txHash = tx[0].hash;
      transactions.push(tx[0]);
      console.log(`Finished ${transactions.length} transactions.` );
      console.log(txHash);
      resolve(txHash);
    }).catch(reject);
  });

  Promise.all([this.getNewAddress(this.sendingSeed)]).then(addresses => {
    this.sengindAddress = addresses[0];
    this.initialized = true;
  })
};

Promoter.prototype.start = function(txHash = null) {
  const self = this;
  let txHashToPromote = txHash;
  const promote = () => {
    if (!self.promoting) return;

    const makeSinglePromote = () => {
      self.singlePromote(txHashToPromote).then(txHash => {
        // txHashToPromote = txHashToPromote || txHash;
        self.checkReference(txHashToPromote)
          .then(({ promotable, confirmed }) => {
            if (!promotable) {
              txHashToPromote = null;
            }
            return confirmed;
          })
          .then((confirmed) => { 
            self.onTransactionCreated(txHash);
            if(confirmed) {
              self.onTransactionConfirmed();
              return Promise.reject('Transaction is confirmed!');
            }
          })
          .then(() => {
            console.log(`Resting for ${DELAY_PERIOD} seconds`);
            setTimeout(promote, DELAY_PERIOD * 1000);
          }).catch((error) => {
            console.log(error);
            self.onTransactionFailure(error);
            self.stop();
          });;
      }).catch((error) => {
        console.log(error);
        self.onTransactionFailure();
        self.stop();
        // self.onTransactionFailure().then(() => {
        //   console.log(`Resting for ${DELAY_PERIOD} seconds`);
        //   setTimeout(promote, DELAY_PERIOD * 1000);
        // });
      });
    };

    if (!txHashToPromote) {
      self.getTransactionToPromote()
        .then(hash => { txHashToPromote = hash; })
        .then(makeSinglePromote);
    } else {
      makeSinglePromote();
    }
  };

  self.promoting = true;
  promote();
};

Promoter.prototype.stop = function() { this.promoting = false; };

Promoter.prototype.setFrequency = function(frequency) { };

Promoter.prototype.onTransactionCreated = function(txHash) { };
Promoter.prototype.onTransactionFailure = function() { };
Promoter.prototype.onTransactionConfirmed = function() { };
