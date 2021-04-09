import { MiddlewareAPI, Dispatch } from 'redux';
import { Firebase } from '../../FirebaseContext';
import {
  GameActionTypes,
  GAME_HOSTING,
  GAME_JOINED,
  GAME_EXITED,
  GAME_START,
  GAME_SEND_SELECTED,
  GAME_SEND_WINNER,
  ErrorType,
  SIGNUP,
  LOGIN,
  NEW_DISPLAY_NAME,
  DELETE_USER,
  GAME_JOINING_EXISTING,
  Pack,
  LOGIN_AS_GUEST,
} from '../actionTypes/gameTypes';
import Axios from 'axios';
import { userLoaded, joinGame, gameStarted, updatePlayers, newRound, error, newDisplayName } from '../actions/gameActions';
import { Subscription } from 'rxjs';

import ReactGA from '../../analytics';
import { GameState } from '../reducers/gameReducer';

export default function firebaseMiddleware(firebase: Firebase) {
  const middleware = function middleware(params: MiddlewareAPI<Dispatch, GameState>) {
    const { dispatch /*getState*/ } = params;
    let newPlayersSubscription: Subscription | null = null;
    let newRoundSubscription: Subscription | null = null;

    firebase.auth.onAuthStateChanged((user) => {
      if (user) {
        firebase.uid = user.uid;
        ReactGA.set({ userId: user.uid });

        user.getIdToken(true).then((idToken) => {
          Axios.defaults.headers.common['Authorization'] = `Bearer ${idToken}`;
        });
        setTimeout(() => {
          dispatch(userLoaded(true, user.uid, user.displayName || ''));
        }, 1000);
      } else {
        dispatch(userLoaded(false, '', ''));
      }
    });

    const checkDisplayName = (displayName: string) => {
      if (!displayName.trim()) {
        dispatch(error('Display name not valid', 'Profile error', ErrorType.PROFILE));
        return false;
      }
      return true;
    };

    return function (next: Dispatch) {
      return async function (action: GameActionTypes) {
        switch (action.type) {
          case LOGIN:
            firebase.doSignInWithEmailAndPassword(action.payload.email, action.payload.password).catch((e) => {
              dispatch(error(e.message, 'Login error', ErrorType.LOGIN));
            });

            break;
          case LOGIN_AS_GUEST:
            if (checkDisplayName(action.payload.displayName)) {
              firebase
                .doSignInAsGuest()
                .then(() => {
                  dispatch(newDisplayName(action.payload.displayName));
                })
                .catch((e) => {
                  dispatch(error(e.message, 'Login error', ErrorType.LOGIN));
                });
            }
            break;
          case SIGNUP:
            if (checkDisplayName(action.payload.displayName)) {
              firebase
                .doCreateUserWithEmailAndPassword(action.payload.email, action.payload.password)
                .then(() => {
                  dispatch(newDisplayName(action.payload.displayName));
                })
                .catch((e) => {
                  dispatch(error(e.message, 'Signup error', ErrorType.SIGNUP));
                });
            }

            break;
          case NEW_DISPLAY_NAME:
            if (checkDisplayName(action.payload.displayName)) {
              firebase.changeDisplayName(action.payload.displayName);
            } else {
              return;
            }
            break;
          case DELETE_USER:
            firebase.deleteUser()?.catch((e) => {
              dispatch(error(e.message, 'Delete user', ErrorType.DELETE_USER));
            });
            break;
          case GAME_HOSTING:
            (async () => {
              const response = await Axios.get<{ roomID: string }>(`/game/createRoom/${action.payload.lang}`);
              dispatch(joinGame(response.data.roomID));
            })();
            break;
          case GAME_JOINING_EXISTING:
            Axios.get<{ roomID?: string; error?: string }>('/game/joinExisting')
              .then((response) => {
                if (response.data.roomID) {
                  dispatch(joinGame(response.data.roomID));
                } else {
                  dispatch(error(response.data.error || 'No room available now', 'Join game', ErrorType.JOIN));
                }
              })
              .catch((e) => {
                dispatch(error(e.message, 'Join game', ErrorType.JOIN));
              });
            break;
          case GAME_JOINED:
            (async () => {
              try {
                await firebase.enterRoom(action.payload.roomID);

                // Richiedo il pack della room corrente
                const packRef = await firebase.getPackRef();

                // Mi assicuro che sia scaricato il pack prima di iniziare il gioco
                const pack = (await Axios.get<Pack>(`/game/pack/${packRef.lang}/${packRef.selectedPack}`)).data;

                // Attendo l'inizio del gioco
                firebase.notifyOnGameStart().then(() => {
                  dispatch(gameStarted(pack));
                });

                newRoundSubscription = firebase.notifyNewRound$(pack).subscribe((newRoundData) => {
                  const { round, cards, role, blackCard, judgeID } = newRoundData;
                  dispatch(newRound(round, cards, role, blackCard, judgeID));
                });

                newPlayersSubscription = firebase.notifyNewPlayers$(pack).subscribe((players) => {
                  dispatch(updatePlayers(players));
                });
              } catch (e) {
                dispatch(error('Cannot join the game', 'Join game', ErrorType.JOIN));
              }
            })();
            break;
          case GAME_START:
            await firebase.startGame();
            break;
          case GAME_EXITED:
            newRoundSubscription?.unsubscribe();
            newPlayersSubscription?.unsubscribe();
            await firebase.exitRoom();
            break;
          case GAME_SEND_SELECTED:
            firebase.sendSelected(action.payload.cards);
            break;
          case GAME_SEND_WINNER:
            await Axios.post('/game/sendWinner', {
              player: action.payload.player.uid,
              roomID: firebase.roomID,
            });
            break;
        }
        return next(action);
      };
    };
  };

  return middleware;
}
