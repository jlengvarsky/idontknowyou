import { createStore, applyMiddleware, Middleware } from 'redux';
import { GameState, gameReducer } from './reducers/gameReducer';
import { TypedUseSelectorHook, useSelector as useReduxSelector } from 'react-redux';
import { composeWithDevTools } from 'redux-devtools-extension';

export const createCustomStore = (middlewares: Middleware[] = []) => {
  return createStore(gameReducer, composeWithDevTools(applyMiddleware(...middlewares)));
};

export const useSelector: TypedUseSelectorHook<GameState> = useReduxSelector;
