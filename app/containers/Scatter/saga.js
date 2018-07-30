import Eos from 'eosjs';
import { takeLatest, put, select, all, call, fork, join } from 'redux-saga/effects';
import {
  makeSelectTokens as selectTokens,
  makeSelectActiveNetwork,
  makeSelectEosClient,
} from 'containers/Remote/selectors';
import { makeSelectEosAccount, makeSelectScatter, makeSelectEosClient as scatterClient, makeSelectEosAuthority, makeSelectTransaction } from 'containers/Scatter/selectors';
import { NOTIFICATION_SUCCESS } from 'containers/Notification/constants';
import { eosLoaded, attachedAccount, detachedAccount, refreshAccountData, refreshedAccountData, pushedTransaction } from './actions';
import { failureNotification, loadingNotification, successNotification } from 'containers/Notification/actions';
import { SCATTER_LOADED, CONNECT_ACCOUNT, REMOVE_ACCOUNT, REFRESH_DATA, PUSH_TRANSACTION } from './constants';


//
// Get the EOS Client once Scatter loads
//
function* pushTransaction() {
  yield put(loadingNotification());
  try {
    const eosAccount = yield select(makeSelectEosAccount());
    const eosAuthority = yield select(makeSelectEosAuthority());
    const transaction = yield select(makeSelectTransaction());
    const eosClient = yield select(scatterClient());
    const actions = transaction.map(tx => {
      return {
        ...tx,
        authorization: [{ actor: eosAccount, permission: eosAuthority }]
      }
    })
    console.log(`Attempting to send tx to scatter: ${JSON.stringify(actions, null, 2)}`);
    const res = yield eosClient.transaction({actions});
    yield put(successNotification(res.transaction_id));
    yield put(pushedTransaction(res));
  } catch (err) {
    console.error("An EOSToolkit error occured - see details below:");
    console.error(err);
    yield put(failureNotification(err));
    yield put(pushedTransaction(err));
  }

}

function* watchPushTransaction() {
  yield takeLatest(PUSH_TRANSACTION, pushTransaction);
}

//
// Get the EOS Client once Scatter loads
//
function* getEosClient() {
  try {
    const active = yield select(makeSelectActiveNetwork());
    const scatter = yield select(makeSelectScatter());
    const scatterConfig = {
      protocol: active.endpoint.protocol,
      blockchain: active.network.network,
      host: active.endpoint.url,
      port: active.endpoint.port,
      chainId: active.network.chainId,
    };

    const eosOptions = {
      broadcast: true,
      sign: true,
      chainId: active.network.chainId,
    };

    const protocol = active.endpoint.protocol;
    const eosClient = scatter.eos(scatterConfig, Eos, eosOptions, protocol);

    yield getEosAccount(false);
    yield put(eosLoaded(eosClient));
  } catch (err) {
    console.error("An EOSToolkit error occured - see details below:");
    console.error(err);
  }

}

function* watchScatterLoaded() {
  yield takeLatest(SCATTER_LOADED, getEosClient);
}

//
// Make the request to connect an account
//

function* getEosAccount(signout = true) {
  const active = yield select(makeSelectActiveNetwork());
  const scatter = yield select(makeSelectScatter());
  const scatterConfig = {
    protocol: active.endpoint.protocol,
    blockchain: active.network.network,
    host: active.endpoint.url,
    port: active.endpoint.port,
    chainId: active.network.chainId,
  };
  yield scatter.suggestNetwork(scatterConfig);
  try {
    if (scatter.identity && signout) {
      yield scatter.forgetIdentity();
    }
    const id = yield scatter.getIdentity({
      accounts: [
        {
          chainId: active.network.chainId,
          blockchain: active.network.network,
        },
      ],
    });
    const eosAccount =
      id && id.accounts.find(x => x.blockchain === active.network.network)
        ? id.accounts.find(x => x.blockchain === active.network.network).name
        : '';
    const accountAuth =
      id && id.accounts.find(x => x.blockchain === active.network.network)
        ? id.accounts.find(x => x.blockchain === active.network.network).authority
        : '';
    yield put(attachedAccount(eosAccount, accountAuth));
    yield put(refreshAccountData());
  } catch (err) {
    console.error("An EOSToolkit error occured - see details below:");
    console.error(err);
  }
}

function* watchScatterConnect() {
  yield takeLatest(CONNECT_ACCOUNT, getEosAccount);
}

//
// Refresh account data
//

// TODO: Dry this out with SearchAccount
function* getCurrency(token, name) {
  try {
    const eosClient = yield select(makeSelectEosClient());
    const currency = yield eosClient.getCurrencyBalance(token, name);
    const currencies = currency.map(c => {
      return {
        account: token,
        balance: c,
      };
    });
    return currencies;
  } catch (c) {
    return [];
  }
}

function* getAccountDetail(name) {
  const eosClient = yield select(makeSelectEosClient());
  const eosTokens = yield select(selectTokens());
  const tokens = yield all(
    eosTokens.map(token => {
      return fork(getCurrency, token.account, name);
    })
  );
  const currencies = yield join(...tokens);
  const balances = currencies.reduce((a, b) => a.concat(b), []);
  return {
    ...(yield eosClient.getAccount(name)),
    balances,
  };
}

function* refreshEosAccountData() {
  const accountName = yield select(makeSelectEosAccount());
  try {
    if (accountName) {
      const account = yield call(getAccountDetail, accountName);
      yield put(refreshedAccountData(account));
    } else {
      yield put(refreshedAccountData(null));
    }
  } catch (err) {
    console.error("An EOSToolkit error occured - see details below:");
    console.error(err);
  }
}

function* watchEosRefreshData() {
  yield takeLatest(REFRESH_DATA, refreshEosAccountData);
}

function* watchEosSuccess() {
  yield takeLatest(NOTIFICATION_SUCCESS, refreshEosAccountData);
}

//
// Remove an account
//

function* removeEosAccount() {
  const scatter = yield select(makeSelectScatter());
  try {
    if (scatter.identity) {
      yield scatter.forgetIdentity();
    }
    yield put(detachedAccount());
    yield put(refreshAccountData());
  } catch (err) {
    console.error("An EOSToolkit error occured - see details below:");
    console.error(err);
  }
}

function* watchScatterRemove() {
  yield takeLatest(REMOVE_ACCOUNT, removeEosAccount);
}

//
// Combine sagas into root saga
//

export default function* rootSaga() {
  yield all([
    watchScatterLoaded(),
    watchScatterConnect(),
    watchScatterRemove(),
    watchEosRefreshData(),
    watchEosSuccess(),
    watchPushTransaction(),
  ]);
}
