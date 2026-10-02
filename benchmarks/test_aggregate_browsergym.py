import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("aggregate-browsergym.py")
SPEC = importlib.util.spec_from_file_location("aggregate_browsergym", SCRIPT_PATH)
AGGREGATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AGGREGATOR)


def episode(task, *, wrapper_reward, raw_reward=None, success=False):
    record = {
        "benchmark": "miniwob",
        "task": task,
        "success": success,
        "actions": 1,
        "latencyMs": 100,
        "reward": wrapper_reward,
    }
    if raw_reward is not None:
        record["rawTaskReward"] = raw_reward
    return record


class AggregateBrowserGymRewardTests(unittest.TestCase):
    def test_prefers_raw_task_reward_over_wrapper_termination_reward(self):
        records = [
            episode("full", wrapper_reward=1, raw_reward=1, success=True),
            episode("partial", wrapper_reward=1, raw_reward=0.625),
            episode("failed", wrapper_reward=0, raw_reward=-1),
        ]

        summary = AGGREGATOR.summarize(records)

        self.assertEqual(summary["rewardField"], "rawTaskReward")
        self.assertEqual(summary["rewardSampleCount"], 3)
        self.assertEqual(summary["partialRewardCount"], 1)
        self.assertAlmostEqual(summary["meanReward"], (1 + 0.625 - 1) / 3)

    def test_falls_back_to_wrapper_reward_when_raw_task_reward_is_missing(self):
        summary = AGGREGATOR.summarize([episode("fallback", wrapper_reward=0.5)])

        self.assertEqual(summary["rewardField"], "reward")
        self.assertEqual(summary["rewardSampleCount"], 1)
        self.assertEqual(summary["partialRewardCount"], 1)
        self.assertEqual(summary["meanReward"], 0.5)

    def test_marks_mixed_reward_sources_instead_of_hiding_them(self):
        records = [
            episode("raw", wrapper_reward=1, raw_reward=0.25),
            episode("wrapper", wrapper_reward=0.75),
        ]

        summary = AGGREGATOR.summarize(records)

        self.assertEqual(summary["rewardField"], "mixed")
        self.assertEqual(summary["rewardSampleCount"], 2)
        self.assertEqual(summary["partialRewardCount"], 2)
        self.assertEqual(summary["meanReward"], 0.5)


if __name__ == "__main__":
    unittest.main()
