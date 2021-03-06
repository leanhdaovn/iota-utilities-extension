const KEEP_TX_QUANTITY = 10;
const providers = ['http://iota-nodes.tilthat.com'];
const blackListedProviders = [];
const transactions = [];
let totalTx = 0;
let promoter;
let reattacher;

const getRandomItem = (array) => {
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
};

const getRandomProvider = () => new Promise((resolve, reject) => {
  const getHealthyProvider = () => {
    const provider = getRandomItem(providers);
    const iota = new IOTA({ provider });
    try {
      iota.api.getNodeInfo((e, s) => { 
        if (e) throw e;
        else resolve(provider);
      });
    } catch(error) {
      getHealthyProvider();
    }
  };

  getHealthyProvider();
});

getRandomProvider()
  .then(provider => new IOTA({ provider: provider }))
  .then(iotaObj => {
    curl.init();
    curl.overrideAttachToTangle(iotaObj);
    promoter = new Promoter({ iotaObj: iotaObj, curlObj: curl });    
    reattacher = new Reattacher({ iotaObj: iotaObj });    
  });


const storeTx = txHash => new Promise((resolve, reject) => {
  const now = Date.now();
  chrome.storage.local.get({spamTransactions: []}, function (result) {
    const transactions = result.spamTransactions;
    while (transactions.length > (KEEP_TX_QUANTITY - 1)) { transactions.shift(); }

    transactions.push({ hash: txHash, timestamp: now });
    chrome.storage.local.set({ spamTransactions: transactions }, resolve);
  });
});

// const createSendTxHash = (port, portState) => {
//   return txHash => {
//     storeTx(txHash).then(() => {
//       if (!portState.connected) return;
//       port.postMessage({ type: 'TRANSACTION_CREATED' });
//     })
//   };
// };

const startSpam = (promoter, port) => {
  chrome.storage.local.get({ spamming: false }, function ({spamming}) {
    if (!spamming) {
      chrome.storage.local.set({ spamming: true })
      console.log("Start spamming");
      const portState = { connected: true };

      if (port) {
        port.onDisconnect.addListener((e) => {
          console.log("disconnected...");
          portState.connected = false;
        });
      }

      const switchProvider = () => new Promise((resolve, reject) => {
        getRandomProvider().then(newProvider => {
          const iota = promoter.iota;
          console.log(`Switching provider from ${iota.provider} to ${newProvider}`);
          iota.changeNode({ provider: newProvider });
          curl.overrideAttachToTangle(iota);
          resolve();
        });
      });

      promoter.onTransactionCreated = txHash => new Promise((resolve, reject) => {
        storeTx(txHash);
        switchProvider().then(resolve);
      });

      promoter.onTransactionFailure = () => new Promise((resolve, reject) => {
        switchProvider().then(resolve);
      });

      promoter.start();
    }
  });
};

const stopSpam = promoter => {
  console.log("Stop spamming");
  promoter.stop();
  chrome.storage.local.set({ spamming: false });
};

const startPromoting = (promoter, txHash) => {
  getPromoteState(promoteState => {
    if (true /*!promoting*/) {
      updatePromoteState(promoteState => {
        promoteState.working = true;
        promoteState.originalTransaction = txHash;
        promoteState.transactions = [];
        promoteState.errorMessage = null;
      });
      console.log("Start promoting");

      const switchProvider = () => new Promise((resolve, reject) => {
        getRandomProvider().then(newProvider => {
          const iota = promoter.iota;
          console.log(`Switching provider from ${iota.provider} to ${newProvider}`);
          iota.changeNode({ provider: newProvider });
          curl.overrideAttachToTangle(iota);
          resolve();
        });
      });

      promoter.onTransactionCreated = txHash => new Promise((resolve, reject) => {
        updatePromoteState(promoteState => {
          promoteState.transactions.push(txHash);
        });
        resolve();
        // switchProvider().then(resolve);
      });

      promoter.onTransactionFailure = error => new Promise((resolve, reject) => {
        // switchProvider().then(resolve);
        stopPromoting(promoter);
        updatePromoteState(promoteState => {
          promoteState.errorMessage = 'Some error occurred. Please try again or Reattach.';
          promoteState.working = false;
        });
        resolve();
      });

      promoter.onTransactionConfirmed = () => new Promise((resolve, reject) => {
        stopPromoting(promoter);
      });

      promoter.start(txHash);
    }
  });
};

const stopPromoting = promoter => {
  console.log("Stop promoting");
  promoter.stop();
  updatePromoteState(promoteState => {
    promoteState.working = false;
  });
};

const startReattach = (reattacher, txnHash) => {
  updateReattachState(reattachState => {
    reattachState.working = true;
    reattachState.originalTransaction = txnHash;
    reattachState.createdTransaction = null;
    reattachState.errorMessage = null;
  });

  reattacher.onReattachSuccess = result => {
    console.log('onReattachSuccess', result);
    let createdTransaction = null;
    if (result && result.length) {
      createdTransaction = result[0].hash;
    }

    updateReattachState(reattachState => {
      reattachState.working = false;
      reattachState.createdTransaction = createdTransaction;
    });
  };
  
  reattacher.onReattachFailure = error => {
    console.error('onReattachFailure', error);
    updateReattachState(reattachState => {
      reattachState.working = false;
      reattachState.errorMessage = 'Reattach failed. Please try again!';
    });
  };

  reattacher.reattach(txnHash);
};

const stopReattach = (reattacher, txnHash) => {
  updateReattachState(reattachState => {
    reattachState.working = false;
    reattachState.originalTransaction = null;
    reattachState.createdTransaction = null;
    reattachState.errorMessage = null;
  });
};

chrome.extension.onConnect.addListener(port => {
  console.log("port connected .....");
  port.onMessage.addListener(function (msg) {
    console.log("message received", msg);
    if (msg['type']) {
      switch (msg.type) {
        case 'START_SPAM':
          startSpam(promoter, port);
          break;
        case 'STOP_SPAM':
          stopSpam(promoter);
          break;
        case 'START_PROMOTING':
          startPromoting(promoter, msg.payload.transactionHash);
          break;
        case 'STOP_PROMOTING':
          stopPromoting(promoter);
          break;
        case 'START_REATTACH':
          startReattach(reattacher, msg.payload.transactionHash);
          break;
        case 'STOP_REATTACH':
          stopReattach(reattacher);
          break;
      }
    }
  });

  port.onDisconnect.addListener((e) => {
    console.log("port disconnected...");
  });

});

const startUp = () => {
  getPromoteState(promoteState => {
    if (promoteState.working) {
      const interval = setInterval(() => {
        // wait for promoter to be initialized
        if (!promoter) {
          return;
        } else {
          clearInterval(interval);
          startPromoting(promoter, promoteState.originalTransaction);
        }
      }, 10);
    }
  });
};

startUp();