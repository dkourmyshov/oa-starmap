"""Reading the OB association census.

The build is short because the catalogue is already in this project's frame, and
that is exactly what makes it worth testing: nothing here converts anything, so
the only way an association can end up in the wrong place is if the columns do
not mean what their names say. These tests are mostly about that.
"""

from __future__ import annotations

import json

import pytest

from oastarmap.build.associations import (
    AssociationStats,
    build_associations,
    read_associations,
)

HEADER = "Name\tAName\tN\tGLON\tGLAT\td\tX\ts_X\tY\ts_Y\tZ\ts_Z\tAgemax\tMtot\tNO\tNB\tAV"
UNITS = " \t \t \tdeg\tdeg\tpc\tpc\tpc\tpc\tpc\tpc\tpc\tMyr\tMsun\t \t \tmag"
DASHES = "\t".join(["-" * 6] * 17)

#: Vela OB2, verbatim from the catalogue. Its Cartesian position, its direction
#: and its distance are three statements about one place, and they agree.
VELA = (
    "Vela OB2\t-\t40\t262.59\t-8.59\t384.90\t-48.47\t15.1\t-373.88\t26.5"
    "\t-54.16\t17.4\t6.7\t2360.0\t4.0\t97.0\t0.1"
)

#: Sco-Cen 1, which the catalogue renames and the sky still calls Sco OB2a.
SCOCEN = (
    "Sco-Cen 1\tSco OB2a\t87\t325.33\t12.81\t137.17\t111.12\t36.9\t-72.36\t35.1"
    "\t31.09\t32.3\t11.9\t4568.0\t6.0\t189.0\t0.1"
)


def write(tmp_path, *rows):
    path = tmp_path / "associations.tsv"
    path.write_text("\n".join(["#comment", HEADER, UNITS, DASHES, *rows]) + "\n", "utf-8")
    return path


def test_reads_the_catalogue_frame_unconverted(tmp_path):
    """The positions are copied, not transformed. That is the whole build.

    Quintana et al. publish heliocentric galactic Cartesian parsecs, which is
    what this project stores, so a number that reaches the screen changed is a
    number something has gone wrong with.
    """
    stats = AssociationStats()
    [vela] = read_associations(write(tmp_path, VELA), stats)
    assert (vela.x, vela.y, vela.z) == (-48.47, -373.88, -54.16)
    assert (vela.sigma_x, vela.sigma_y, vela.sigma_z) == (15.1, 26.5, 17.4)
    assert stats.accepted == 1


def test_keeps_the_shape_rather_than_a_radius(tmp_path):
    """Three dispersions, not one.

    An OB association is a chain or a sheet. Averaging the axes at read time
    would throw the shape away before anything could draw it, and Ori OB1b is
    half again as extended along one axis as another.
    """
    stats = AssociationStats()
    [scocen] = read_associations(write(tmp_path, SCOCEN), stats)
    assert len({scocen.sigma_x, scocen.sigma_y, scocen.sigma_z}) == 3


def test_carries_the_classical_designation(tmp_path):
    """Sco-Cen 1 is Sco OB2a, and a reader checking against the sky wants both."""
    stats = AssociationStats()
    [scocen] = read_associations(write(tmp_path, SCOCEN), stats)
    assert scocen.name == "Sco-Cen 1"
    assert scocen.alt_name == "Sco OB2a"
    # A lone dash is VizieR for "this column has no value", not a name.
    [vela] = read_associations(write(tmp_path, VELA), AssociationStats())
    assert vela.alt_name == ""


def test_refuses_a_transposed_axis(tmp_path):
    """The check the whole build rests on.

    Swapping Y and Z leaves the distance from Sol almost unchanged and moves the
    association tens of degrees across the sky. A radius check alone would pass
    it; on screen it would put Vela out of the galactic plane and look merely
    surprising. So the direction is checked against the l and b the same row
    states, and a row that fails is a reason to stop rather than to draw 55.
    """
    swapped = VELA.replace(
        "\t-373.88\t26.5\t-54.16\t17.4", "\t-54.16\t17.4\t-373.88\t26.5"
    )
    with pytest.raises(ValueError, match="degrees apart"):
        read_associations(write(tmp_path, swapped), AssociationStats())


def test_refuses_a_position_that_contradicts_its_own_distance(tmp_path):
    moved = VELA.replace("\t384.90\t", "\t900.00\t")
    with pytest.raises(ValueError, match="but the catalogue states"):
        read_associations(write(tmp_path, moved), AssociationStats())


def test_tolerates_the_disagreement_a_median_creates(tmp_path):
    """Every number in this catalogue is a median taken per column.

    The median of a set of distances is not the length of the vector of median
    coordinates, and for a group as spread out as Cep OB6 — 34 pc of spread at
    207 pc — that alone is four per cent. A check tight enough to call that an
    error would reject the catalogue for being what it is.
    """
    cep = (
        "Cep OB6\t-\t18\t101.87\t-1.17\t206.97\t-45.07\t34.3\t193.44\t25.6"
        "\t-4.93\t16.9\t127.4\t957.0\t0.0\t42.0\t0.1"
    )
    stats = AssociationStats()
    assert len(read_associations(write(tmp_path, cep), stats)) == 1


def test_counts_a_row_it_cannot_place(tmp_path):
    """Nothing is dropped silently, and a missing dispersion is not a zero."""
    blank = VELA.replace("\t-373.88\t26.5\t", "\t\t\t")
    stats = AssociationStats()
    assert read_associations(write(tmp_path, blank), stats) == []
    assert stats.excluded["incomplete position"] == 1


def test_orders_by_distance(tmp_path):
    stats = AssociationStats()
    entries = read_associations(write(tmp_path, VELA, SCOCEN), stats)
    assert [entry.name for entry in entries] == ["Sco-Cen 1", "Vela OB2"]


def test_writes_the_dataset(tmp_path):
    source = write(tmp_path, VELA, SCOCEN)
    out = tmp_path / "out"
    out.mkdir()
    fragment = build_associations(out, source)
    assert fragment is not None
    assert fragment["count"] == 2

    names = json.loads((out / "associations.names.json").read_text(encoding="utf-8"))
    assert [entry["name"] for entry in names] == ["Sco-Cen 1", "Vela OB2"]
    # Seven floats an association, and the renderer refuses the file otherwise.
    assert fragment["files"]["geometry"]["shape"] == [2, 7]
    # The limit is the census's, and the manifest has to say which.
    assert "1 kpc" in fragment["selection"]["note"]


def test_says_the_outline_is_not_an_edge(tmp_path):
    """The one thing a reader could get wrong from the picture alone.

    Every other extent on this map is a size. This one is a contour through a
    distribution with much of the association outside it, and the manifest says
    so where the renderer can read it rather than only in a comment here.
    """
    out = tmp_path / "out"
    out.mkdir()
    extent = build_associations(out, write(tmp_path, VELA))["layout"]["extent"]
    assert extent["kind"] == "ellipsoid"
    assert extent["sigma"] == 1.0
    assert "no boundary" in extent["note"]


def test_absent_catalogue_is_not_an_error(tmp_path):
    """A clone whose raw/ predates this catalogue builds everything else."""
    assert build_associations(tmp_path, tmp_path / "nothing.tsv") is None
