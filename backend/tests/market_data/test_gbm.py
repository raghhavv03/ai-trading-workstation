import math
import random

from app.market_data.gbm import correlated_z, dt_for_interval, step


def test_dt_for_interval_scales_linearly():
    dt_half = dt_for_interval(0.5)
    dt_full = dt_for_interval(1.0)
    assert math.isclose(dt_full, dt_half * 2)


def test_step_zero_z_grows_at_drift_minus_half_variance():
    dt = dt_for_interval(0.5)
    price = step(100.0, drift=0.10, volatility=0.30, dt=dt, z=0.0)
    expected = 100.0 * math.exp((0.10 - 0.5 * 0.30**2) * dt)
    assert math.isclose(price, expected, rel_tol=1e-9)


def test_step_positive_z_moves_price_up():
    dt = dt_for_interval(0.5)
    price = step(100.0, drift=0.10, volatility=0.30, dt=dt, z=3.0)
    assert price > 100.0


def test_step_negative_z_moves_price_down():
    dt = dt_for_interval(0.5)
    price = step(100.0, drift=0.10, volatility=0.30, dt=dt, z=-3.0)
    assert price < 100.0


def test_step_never_produces_negative_or_nan_price():
    dt = dt_for_interval(0.5)
    price = step(100.0, drift=0.10, volatility=0.30, dt=dt, z=-8.0)  # extreme down-shock
    assert price > 0
    assert not math.isnan(price)


def test_step_zero_volatility_is_deterministic_regardless_of_z():
    dt = dt_for_interval(0.5)
    price_a = step(100.0, drift=0.10, volatility=0.0, dt=dt, z=5.0)
    price_b = step(100.0, drift=0.10, volatility=0.0, dt=dt, z=-5.0)
    assert math.isclose(price_a, price_b, rel_tol=1e-9)


def test_correlated_z_rho_one_matches_group_exactly():
    rng = random.Random(0)
    assert correlated_z(rng, group_z=1.5, rho=1.0) == 1.5


def test_correlated_z_rho_zero_ignores_group():
    rng = random.Random(0)
    idiosyncratic_only = rng.gauss(0, 1)
    rng2 = random.Random(0)
    assert correlated_z(rng2, group_z=999.0, rho=0.0) == idiosyncratic_only


def test_correlated_z_intermediate_rho_blends_both_components():
    rng = random.Random(1)
    z = correlated_z(rng, group_z=2.0, rho=0.6)
    # Not exactly the group value, not exactly independent noise -- a blend.
    assert z != 2.0
